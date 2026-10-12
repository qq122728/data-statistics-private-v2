"""Run with an isolated Hermes profile; no Telegram connection or messages."""
import asyncio
import json
from types import SimpleNamespace

from gateway.config import Platform, load_gateway_config
from gateway.platforms.base import MessageEvent
from gateway.run_inbound import GatewayInboundMixin
from gateway.session import SessionSource
from hermes_cli.lifecycle import invoke_hook
from hermes_cli.plugins import discover_plugins

load_gateway_config()
discover_plugins()

async def check():
    runner = SimpleNamespace(_draining=False, _hm_quick_commands=lambda: {})
    cases = 0
    for chat, kind in [('8387614254', 'dm'), ('-5133647199', 'group')]:
        source = SessionSource(platform=Platform.TELEGRAM, chat_id=chat,
            user_id='8387614254', chat_type=kind, message_id='command-check')
        for text in ['/help@ziyuanfeicanmou_bot', '/start', '/commands', '/resource_help', '/update']:
            event = MessageEvent(text=text, source=source, message_id='command-check')
            for result in invoke_hook('pre_gateway_dispatch', event=event, gateway=None, session_store=None):
                if isinstance(result, dict) and result.get('action') == 'rewrite':
                    event.text = result['text']
            command = event.text.split()[0][1:].split('@')[0]
            handled, reply, _ = await GatewayInboundMixin._hm_dispatch_quick_and_plugin_commands(
                runner, event, source, command)
            assert handled and '资源参谋｜Hermes' in reply, (text, handled, reply)
            cases += 1
        event = MessageEvent(text='/resource_excel', source=source, message_id='command-check')
        rewritten = invoke_hook('pre_gateway_dispatch', event=event, gateway=None, session_store=None)
        assert any(isinstance(x, dict) and x.get('text') == '把刚才查询的结果导出 Excel' for x in rewritten)
    print(json.dumps({'helpDispatchCases': cases, 'excelRewrite': True, 'telegramMessagesSent': 0}))

asyncio.run(check())
