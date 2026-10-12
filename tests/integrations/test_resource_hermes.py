"""Reset tests use isolated sessions and a fake model; no production data or API calls."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[2] / 'integrations/resource-hermes/server.py'

class ResetTests(unittest.TestCase):
    def test_reset_removes_only_current_history_and_next_turn_starts_empty(self):
        with tempfile.TemporaryDirectory() as temp, patch.dict(os.environ, {
            'HERMES_HOME': temp, 'RESOURCE_HERMES_TOKEN': 'x' * 40, 'DEEPSEEK_API_KEY': 'fake-test-only',
        }):
            spec = importlib.util.spec_from_file_location('resource_server_test', SOURCE)
            server = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(server)
            Path(temp, 'INSTRUCTIONS.md').write_text('Test instructions')
            seen = []
            class Agent:
                valid_tool_names = {'query_resource_report', 'describe_resource_scope'}
                def __init__(self, **kwargs): pass
                def run_conversation(self, text, conversation_history=None):
                    seen.append(conversation_history)
                    return {'completed': True, 'final_response': 'ok', 'messages': [
                        {'role': 'user', 'content': text}, {'role': 'assistant', 'content': 'ok'}]}
            with patch.dict(sys.modules, {'run_agent': types.SimpleNamespace(AIAgent=Agent)}):
                payload = {'session': 'one:4:4', 'text': 'previous country Germany', 'runId': 'a' * 48, 'today': '2026-10-12', 'chatType': 'private'}
                server.converse(payload)
                server.converse(payload)
                self.assertIsNotNone(seen[-1])
                other = server.SESSIONS / (hashlib.sha256(b'one:-100:4').hexdigest() + '.json')
                other.write_text('{"messages": []}')
                self.assertEqual(server.reset_session({'session': payload['session']}), {'reset': True})
                server.converse({**payload, 'text': 'new question'})
                self.assertIsNone(seen[-1])
                self.assertTrue(other.exists())
                self.assertEqual(server.reset_session({'session': 'missing-session'}), {'reset': True})
                for bad in [[], {}, {'session': ''}, {'session': 1}, {'session': 'a' * 301}, {'session': 'x', 'path': '../other'}]:
                    with self.assertRaises(ValueError): server.reset_session(bad)
                # Arbitrary input is hashed, never used as a filesystem path.
                server.reset_session({'session': '../INSTRUCTIONS.md'})
                self.assertTrue(Path(temp, 'INSTRUCTIONS.md').exists())

if __name__ == '__main__': unittest.main()
