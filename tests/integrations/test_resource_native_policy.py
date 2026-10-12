"""Native gateway ingress/tool policy, isolated from Telegram and production."""
import importlib.util
import os
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch
SOURCE = Path(__file__).resolve().parents[2] / 'integrations/resource-hermes/resource-reports/native.py'
class NativePolicyTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {'RESOURCE_GROUP_CHAT_ID': '-123', 'RESOURCE_PRIVATE_USER_IDS': '42'})
        self.env.start()
        self.values = {}
        module = types.ModuleType('gateway.session_context')
        module.get_session_env = lambda key: self.values.get(key, '')
        self.modules = patch.dict(sys.modules, {'gateway': types.ModuleType('gateway'), 'gateway.session_context': module})
        self.modules.start()
        spec = importlib.util.spec_from_file_location('resource_native_test', SOURCE)
        self.native = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.native)
    def tearDown(self):
        self.modules.stop(); self.env.stop()
    def event(self, user='42', chat='42', kind='dm', text='查询本月投流效果', mid='123'):
        source = types.SimpleNamespace(platform=types.SimpleNamespace(value='telegram'), chat_id=chat,
            user_id=user, chat_type=kind, is_bot=False, message_id=mid)
        return types.SimpleNamespace(source=source, text=text, message_id=mid)
    def bind(self, event, session='session-A'):
        src = event.source
        self.values.update({f'HERMES_SESSION_{k}':v for k,v in dict(PLATFORM='telegram', CHAT_ID=src.chat_id,
            USER_ID=src.user_id, CHAT_TYPE=src.chat_type, MESSAGE_ID=src.message_id, ID=session).items()})
    def test_private_group_authorization(self):
        self.assertIsNone(self.native.inbound(self.event()))
        self.assertIsNone(self.native.inbound(self.event(user='99', chat='-123', kind='group')))
        for e in [self.event(user='99', chat='99'), self.event(chat='-456',kind='group')]:
            self.assertEqual(self.native.inbound(e)['action'], 'skip')
    def test_context_separated_and_command_scope(self):
        e = self.event(text='/sms@resource_bot'); self.native.inbound(e); self.bind(e)
        self.assertEqual(self.native.context()['text'], '查询本月短信渠道效果')
        self.values['HERMES_SESSION_MESSAGE_ID'] = '999'
        with self.assertRaises(ValueError): self.native.context()
        for cmd in ('/terminal rm -rf /', '/config', '/update', '/cron', '/model', '/skills'):
            self.assertEqual(self.native.inbound(self.event(text=cmd))['text'], '/resource_help')
        for cmd in ('/new', '/stop', '/status'):
            self.assertIsNone(self.native.inbound(self.event(text=cmd)))
    def test_tool_gate_fail_closed(self):
        self.assertEqual(self.native.guard('query_resource_report')['action'], 'block')
        e = self.event(); self.native.inbound(e); self.bind(e)
        self.assertIsNone(self.native.guard('query_resource_report'))
        for name in ('terminal', 'write_file', 'memory', 'skill_manage', 'send_message', 'execute_code'):
            self.assertEqual(self.native.guard(name)['action'], 'block')
        e.source.is_bot = True
        self.assertEqual(self.native.inbound(e)['action'], 'skip')
    def test_cached_agent_session_is_bound_by_trusted_hook(self):
        e = self.event(); self.native.inbound(e); self.bind(e, session='')
        self.assertEqual(self.native.guard('query_resource_report')['action'], 'block')
        self.assertIsNone(self.native.guard('query_resource_report', session_id='session-A'))
        self.assertEqual(self.native.context()['sessionId'], 'session-A')
        # The next message cannot inherit the previous tool's authorization.
        e = self.event(mid='124'); self.native.inbound(e); self.bind(e, session='')
        with self.assertRaises(ValueError): self.native.context()
        self.assertIsNone(self.native.guard('query_resource_report', session_id='session-B'))
        self.assertEqual(self.native.context()['sessionId'], 'session-B')
        self.values['HERMES_SESSION_ID'] = 'different-session'
        self.assertEqual(self.native.guard('query_resource_report', session_id='session-B')['action'], 'block')
    def test_tool_identity_does_not_cross_users_messages_or_sessions(self):
        e = self.event(); self.native.inbound(e); self.bind(e, session='')
        self.assertIsNone(self.native.guard('query_resource_report', session_id='session-A'))
        self.assertEqual(self.native.guard('query_resource_report', session_id='session-B')['action'], 'block')
        self.assertEqual(self.native.context()['sessionId'], 'session-A')
        self.values['HERMES_SESSION_USER_ID'] = '99'
        with self.assertRaises(ValueError): self.native.context()
        self.values['HERMES_SESSION_USER_ID'] = '42'
        self.values['HERMES_SESSION_MESSAGE_ID'] = 'different-message'
        with self.assertRaises(ValueError): self.native.context()
if __name__ == '__main__': unittest.main()
