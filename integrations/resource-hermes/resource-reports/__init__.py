"""Read-only Hermes tools; transport and query authorization stay outside the model."""
import json
import os
from pathlib import Path
import urllib.request
import urllib.error

PARAMETERS = json.loads((Path(__file__).parent / 'query-schema.json').read_text())

def request(path, args):
    if os.environ.get('RESOURCE_NATIVE_GATEWAY') == '1':
        try:
            from .native import begin_run
            run_id = begin_run()
        except Exception:
            return json.dumps({'error': '没有有效的查询会话，请在已授权对话重新提问'}, ensure_ascii=False)
    else:
        run_id = os.environ.get('RESOURCE_QUERY_RUN', '')
    payload = {'runId': run_id}
    if path == '/query':
        payload['query'] = args
    elif path == '/workbook':
        payload['workbook'] = args
    raw = json.dumps(payload).encode()
    if len(raw) > 8192:
        return json.dumps({'error': '查询过长'})
    req = urllib.request.Request('http://127.0.0.1:' + os.environ.get('RESOURCE_QUERY_PORT', '4187') + path, data=raw, headers={
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
    if os.environ.get('RESOURCE_NATIVE_GATEWAY') == '1':
        from .native import install
        install(ctx)
    description = '只读查询真实投手、短信、渠道、国家、素材、成本、开单及完整号码。analysis用于日报、预警、实际收款、开单批次后续贡献及7/30/60日同龄表现（一次一个自然月内日期），优先读取analysis结构化结果和数据缺口；effects按导入日期累计转化；orders按开单日期；phone用完整号码和period=all。单表导出用excel=true；多报表合成时excel=false，收集reportId再调用create_resource_workbook。金额单位为分，text中已换算；所有数字必须实际查询。'
    ctx.register_tool(name='query_resource_report', toolset='resource_reports', schema={
        'name': 'query_resource_report', 'description': description, 'parameters': PARAMETERS},
        handler=lambda args, **kwargs: request('/query', args), description=description, emoji='📊')
    description = '读取当前实际渠道、投手、素材名称和业务统计日。没有登记投手并不表示没有业务开单。'
    ctx.register_tool(name='describe_resource_scope', toolset='resource_reports', schema={
        'name': 'describe_resource_scope', 'description': description,
        'parameters': {'type': 'object', 'properties': {}, 'additionalProperties': False}},
        handler=lambda args, **kwargs: request('/catalog', {}), description=description, emoji='🔎')
    description = '把本次已查询的1至4份真实报表合成一份Excel，含对比汇总、查询口径及完整明细。只接受本次query_resource_report返回的reportId；不能传数字、公式、文件路径或编造行。用户明确要Excel时使用。文件由系统发送到原对话。'
    ctx.register_tool(name='create_resource_workbook', toolset='resource_reports', schema={
        'name': 'create_resource_workbook', 'description': description,
        'parameters': {'type': 'object', 'properties': {'reportIds': {'type': 'array', 'minItems': 1, 'maxItems': 4,
            'items': {'type': 'string', 'pattern': '^[a-f0-9]{24}$'}}}, 'required': ['reportIds'], 'additionalProperties': False}},
        handler=lambda args, **kwargs: request('/workbook', args), description=description, emoji='📑')
