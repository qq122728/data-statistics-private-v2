"""Hermes AIAgent conversation service. Telegram and database credentials stay outside this process."""
import contextlib
import hashlib
import hmac
import json
import logging
import os
from pathlib import Path
import time
import traceback
import uuid
from http.server import BaseHTTPRequestHandler, HTTPServer

HOME = Path(os.environ['HERMES_HOME'])
SESSIONS = HOME / 'resource_sessions'
SESSIONS.mkdir(parents=True, exist_ok=True, mode=0o700)
SECRET = os.environ.get('RESOURCE_HERMES_TOKEN', '')
if len(SECRET) < 32:
    raise RuntimeError('Hermes connection credential missing')
logging.disable(logging.CRITICAL)


def converse(payload):
    from run_agent import AIAgent
    key = hashlib.sha256(payload['session'].encode()).hexdigest()
    path = SESSIONS / (key + '.json')
    history = []
    if path.exists() and time.time() - path.stat().st_mtime < 3600:
        history = json.loads(path.read_text()).get('messages', [])
    os.environ['RESOURCE_QUERY_RUN'] = payload['runId']
    rules = (HOME / 'INSTRUCTIONS.md').read_text() + '\n当前业务统计日：' + payload['today']
    with open(os.devnull, 'w') as sink, contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
        agent = AIAgent(
            provider='deepseek', model=os.environ.get('DEEPSEEK_MODEL', 'deepseek-v4-flash'),
            base_url='https://api.deepseek.com/v1', api_key=os.environ['DEEPSEEK_API_KEY'],
            enabled_toolsets=['resource_reports'], max_iterations=6, max_tokens=2200,
            quiet_mode=True, verbose_logging=False, save_trajectories=False,
            ephemeral_system_prompt=rules, skip_context_files=True, load_soul_identity=True,
            skip_memory=True, skip_background_review=True,
            session_id=str(uuid.uuid5(uuid.NAMESPACE_URL, 'resource:' + key)),
            platform='telegram', user_id=key, chat_type='group', run_budget_seconds=110,
        )
        if agent.valid_tool_names != {'query_resource_report', 'describe_resource_scope'}:
            (HOME / 'tool_scope.json').write_text(json.dumps(sorted(agent.valid_tool_names)))
            raise RuntimeError('Unexpected Hermes tool scope')
        try:
            result = agent.run_conversation(payload['text'], conversation_history=history or None)
        finally:
            if callable(getattr(agent, 'close', None)):
                agent.close()
    text = result.get('final_response', '')
    if not isinstance(text, str) or not text.strip() or result.get('completed') is False:
        raise RuntimeError('Hermes response incomplete')
    messages = [m for m in result.get('messages', []) if m.get('role') != 'system']
    while len(messages) > 50:
        next_user = next((i for i, m in enumerate(messages[1:], 1) if m.get('role') == 'user'), None)
        if next_user is None:
            break
        messages = messages[next_user:]
    temp = path.with_suffix('.tmp')
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as f:
        json.dump({'messages': messages}, f, ensure_ascii=False)
    os.replace(temp, path)
    for old in SESSIONS.glob('*.json'):
        if time.time() - old.stat().st_mtime > 86400:
            old.unlink()
    return {'text': text[:12000]}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def reply(self, code, value):
        body = json.dumps(value, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if not hmac.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + SECRET):
            return self.reply(403, {'error': 'Not authorized'})
        if self.path != '/converse':
            return self.reply(404, {'error': 'Not found'})
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 8192:
                return self.reply(413, {'error': 'Request too large'})
            p = json.loads(self.rfile.read(size))
            if set(p) != {'text', 'session', 'runId', 'today'} or not all(isinstance(v, str) for v in p.values()):
                raise ValueError()
            if len(p['text']) > 1500 or len(p['session']) > 300 or len(p['runId']) != 48:
                raise ValueError()
            return self.reply(200, converse(p))
        except Exception as error:
            (HOME / "last_error.json").write_text(json.dumps({"type": type(error).__name__, "frames": [{"file": f.filename, "line": f.lineno, "function": f.name} for f in traceback.extract_tb(error.__traceback__)]}))
            return self.reply(503, {'error': 'Hermes response not completed'})
        finally:
            os.environ.pop('RESOURCE_QUERY_RUN', None)


if __name__ == '__main__':
    HTTPServer(('127.0.0.1', 4188), Handler).serve_forever()
