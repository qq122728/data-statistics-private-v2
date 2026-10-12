"""Two real AI turns using the gateway binder and one cached agent; no Telegram sends."""
import asyncio
import contextlib
import json
import logging
import os
import uuid
from types import SimpleNamespace

logging.disable(logging.CRITICAL)
with open(os.devnull, 'w') as sink, contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
    from run_agent import AIAgent
    from gateway.config import Platform
    from gateway.run import GatewayRunner
    from gateway.session import SessionContext, SessionSource
    from gateway.platforms.base import MessageEvent
    from gateway.session_context import get_session_env, clear_session_vars
    from hermes_cli.lifecycle import invoke_hook

    sid = 'resource-session-check-' + str(uuid.uuid4())
    runner = SimpleNamespace(adapters={})
    history = []
    summaries = []
    agent = None
    prompts = [
        '请调用 describe_resource_scope 读取当前渠道目录。只答查询成功或失败。',
        '请调用 query_resource_report，view=effects、type=ADS、country=DE、period=month、excel=true。查询德国投手并导出 Excel。必须重新调用工具。只答成功或失败，并附生成文件。',
    ]
    for turn, text in enumerate(prompts):
        source = SessionSource(platform=Platform.TELEGRAM, chat_id='-5133647199',
            user_id='8387614254', chat_type='group', message_id=str(990000 + turn))
        event = MessageEvent(text=text, source=source, message_id=source.message_id)
        context = SessionContext(source=source, connected_platforms=[Platform.TELEGRAM],
            home_channels={}, session_key='resource-session-check', session_id=sid)
        tokens = GatewayRunner._set_session_env(runner, context)
        # Reproduces the native gateway resetting SESSION_ID on every incoming turn.
        assert not get_session_env('HERMES_SESSION_ID')
        if agent is None:
            agent = AIAgent(provider='deepseek', model='deepseek-v4-flash',
                base_url='https://api.deepseek.com/v1', api_key=os.environ['DEEPSEEK_API_KEY'],
                enabled_toolsets=['resource_reports'], max_iterations=6, max_tokens=1000,
                quiet_mode=True, verbose_logging=False, save_trajectories=False, session_id=sid,
                platform='telegram', user_id=source.user_id, chat_id=source.chat_id, chat_type='group',
                run_budget_seconds=90, load_soul_identity=True)
        results = invoke_hook('pre_gateway_dispatch', event=event, gateway=None, session_store=None)
        assert not any(isinstance(r, dict) and r.get('action') == 'skip' for r in results)
        old_length = len(history)
        result = agent.run_conversation(text, conversation_history=history)
        history = result.get('messages', [])
        replies = []
        for m in history[old_length:]:
            if m.get('role') == 'tool':
                try: replies.append(json.loads(m.get('content', '{}')))
                except (ValueError, TypeError): pass
        errors = [r['error'] for r in replies if r.get('error')]
        success = bool(replies) and not errors
        if turn == 1:
            success = success and any(r.get('query', {}).get('country') == 'DE' and r.get('media') for r in replies)
        summaries.append({'turn': turn + 1, 'success': bool(success), 'toolReplies': len(replies), 'errors': errors})
        clear_session_vars(tokens)
    agent.close()
print(json.dumps({'turns': summaries, 'telegramMessagesSent': 0}, ensure_ascii=False))
assert all(x['success'] for x in summaries), 'Gateway cached-agent query regression'
