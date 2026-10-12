"""Native Hermes gateway policy and trusted request context (never supplied by the model)."""
import json
import os
import threading
import time
from pathlib import Path
import urllib.request
from gateway.session_context import get_session_env

ALLOWED_TOOLS = frozenset({'query_resource_report', 'describe_resource_scope', 'create_resource_workbook'})
SAFE_COMMANDS = frozenset({'new', 'reset', 'stop', 'status', 'whoami', 'resource_help'})
QUICK_QUERIES = {
    'effects': '查询本月投流投手效果', 'sms': '查询本月短信渠道效果',
    'orders': '查询本月开单号码', 'next': '继续查看上一份查询的下一页',
    'export': '把刚才查询的结果导出 Excel',
    'resource_excel': '把刚才查询的结果导出 Excel',
}
HELP = '''资源参谋｜Hermes 资源分析助手

可以直接对话，也可以在已绑定的群里 @我。
投流：渠道、投手、国家、素材、消耗和转化效果。
短信：渠道、供应方、国家、批次和转化效果。
号码：完整号码、接粉日期、开单日期及首充、续充金额。
表格：查询结果导出 Excel，多份报表合成对比表。

/new 新建对话  /stop 停止本次回答
/status 会话状态  /effects 投流效果
/sms 短信效果  /orders 开单号码
/next 下一页  /resource_excel 导出 Excel

业务数据只读。修改数据、账号或权限请在网页办理。'''
_turns = {}
_lock = threading.Lock()

def _allowed(chat, user, kind):
    private = set(filter(None, os.environ.get('RESOURCE_PRIVATE_USER_IDS', '').split(',')))
    return bool(user) and ((chat == user and user in private) if kind in ('dm', 'private')
        else kind in ('group', 'supergroup', 'forum') and chat == os.environ.get('RESOURCE_GROUP_CHAT_ID'))

def inbound(event, **kwargs):
    source = event.source
    platform = getattr(getattr(source, 'platform', None), 'value', '')
    chat, user, kind = str(source.chat_id or ''), str(source.user_id or ''), source.chat_type
    if platform != 'telegram' or source.is_bot or not _allowed(chat, user, kind):
        return {'action': 'skip', 'reason': 'Resource conversation not authorized'}
    text = (event.text or '').strip()
    rewritten = text
    if text.startswith('/'):
        command = text.split()[0][1:].split('@')[0].lower()
        if command in ('help', 'start', 'commands'):
            rewritten = '/resource_help'
        elif command in QUICK_QUERIES:
            rewritten = QUICK_QUERIES[command]
        elif command not in SAFE_COMMANDS:
            rewritten = '/resource_help'
    message = str(source.message_id or event.message_id or '')
    if message and rewritten:
        with _lock:
            now = time.monotonic()
            for key in list(_turns):
                if _turns[key][0] < now: del _turns[key]
            if len(_turns) >= 1000:
                return {'action': 'skip', 'reason': 'Resource request capacity reached'}
            _turns[(chat, user, message)] = (now + 600, rewritten[:6000], '')
    if rewritten != text: return {'action': 'rewrite', 'text': rewritten}

def context(*, runtime_session_id=None):
    get = lambda key: str(get_session_env('HERMES_SESSION_' + key) or '')
    chat, user, kind, message = get('CHAT_ID'), get('USER_ID'), get('CHAT_TYPE'), get('MESSAGE_ID')
    if get('PLATFORM') != 'telegram' or not _allowed(chat, user, kind):
        raise ValueError('当前对话未授权资源查询')
    session = get('ID')
    with _lock:
        key = (chat, user, message)
        turn = _turns.get(key)
        if not turn or turn[0] < time.monotonic():
            raise ValueError('当前查询上下文已过期，请重新提问')
        # Hermes restores ContextVars between middleware and tool execution.
        # Bind the trusted hook's agent ID to this exact authorized message,
        # so both phases can resolve it without a process-wide session fallback.
        if runtime_session_id:
            if (session and session != runtime_session_id) or (turn[2] and turn[2] != runtime_session_id):
                raise ValueError('查询会话编号不一致')
            turn = (turn[0], turn[1], runtime_session_id)
            _turns[key] = turn
        if session and turn[2] and session != turn[2]:
            raise ValueError('查询会话编号不一致')
        session = session or turn[2]
        if not session:
            raise ValueError('当前查询上下文已过期，请重新提问')
    return dict(platform='telegram', chatId=chat, userId=user, chatType=kind,
        sessionId=session, messageId=message, text=turn[1])

def begin_run():
    req = urllib.request.Request('http://127.0.0.1:' + os.environ.get('RESOURCE_QUERY_PORT', '4187') + '/native/begin',
        data=json.dumps(context()).encode(), headers={'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + os.environ.get('RESOURCE_HERMES_TOKEN', '')}, method='POST')
    with urllib.request.urlopen(req, timeout=15) as response:
        return json.loads(response.read(4096))['runId']

def guard(tool_name, session_id=None, **kwargs):
    if tool_name not in ALLOWED_TOOLS:
        return {'action': 'block', 'message': '资源参谋只允许业务查询和表格生成，禁止其他工具。'}
    try:
        # Cached Hermes agents retain their session_id, but the gateway resets
        # HERMES_SESSION_ID between turns. The hook carries the live agent ID.
        context(runtime_session_id=session_id)
    except Exception:
        return {'action': 'block', 'message': '没有有效的资源查询会话，请在已授权对话重新提问。'}

def install(ctx):
    rules = (Path(os.environ['HERMES_HOME']) / 'INSTRUCTIONS.md').read_text()
    if len(rules) > 7500:
        raise RuntimeError('Resource instructions exceed prompt budget')
    for i in range(0, len(rules), 3750):
        ctx.register_system_prompt_section('resource.rules.' + str(i // 3750), rules[i:i+3750], max_chars=4000)
    ctx.register_hook('pre_gateway_dispatch', inbound)
    ctx.register_hook('pre_tool_call', guard)
    # Hermes dispatch normalizes Telegram underscores to hyphens before lookup.
    ctx.register_command('resource-help', lambda raw_args: HELP, description='资源参谋功能与只读范围')
    for name, text in QUICK_QUERIES.items():
        if name == 'export': continue  # Native CLI already reserves this alias.
        ctx.register_command(name.replace('_', '-'), lambda raw_args: HELP, description=text)
