"""Read-only Hermes tools; transport and query authorization stay outside the model."""
import json
import os
from pathlib import Path
import urllib.request
import urllib.error

PARAMETERS = json.loads((Path(__file__).parent / 'query-schema.json').read_text())

def request(path, args):
    payload = {'runId': os.environ.get('RESOURCE_QUERY_RUN', '')}
    if path == '/query':
        payload['query'] = args
    raw = json.dumps(payload).encode()
    if len(raw) > 8192:
        return json.dumps({'error': '查询过长'})
    req = urllib.request.Request('http://127.0.0.1:4187' + path, data=raw, headers={
        'Content-Type': 'application/json', 'Authorization': 'Bearer ' + os.environ.get('RESOURCE_HERMES_TOKEN', '')}, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.read(60000).decode()
    except urllib.error.HTTPError as e:
        if e.code in (400, 403, 413, 429):
            return e.read(4096).decode()
        return json.dumps({'error': '数据查询暂时不可用'}, ensure_ascii=False)
    except Exception:
        return json.dumps({'error': '数据查询暂时不可用'}, ensure_ascii=False)

def register(ctx):
    description = '查询真实投手、短信、渠道、国家、素材、成本、开单及完整号码。effects按导入日期累计转化；orders按开单日期；phone用完整号码和period=all；issues查缺失归属/消耗。Excel由外层直接发送到原群。所有数字必须实际查询，不能猜。'
    ctx.register_tool(name='query_resource_report', toolset='resource_reports', schema={
        'name': 'query_resource_report', 'description': description, 'parameters': PARAMETERS},
        handler=lambda args, **kwargs: request('/query', args), description=description, emoji='📊')
    description = '读取当前实际渠道、投手、素材名称和业务统计日。没有登记投手并不表示没有业务开单。'
    ctx.register_tool(name='describe_resource_scope', toolset='resource_reports', schema={
        'name': 'describe_resource_scope', 'description': description,
        'parameters': {'type': 'object', 'properties': {}, 'additionalProperties': False}},
        handler=lambda args, **kwargs: request('/catalog', {}), description=description, emoji='🔎')
