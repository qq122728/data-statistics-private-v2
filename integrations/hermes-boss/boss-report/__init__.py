"""Only exposes validated report queries. No SQL, shell, writes or outgoing sends."""
import json
import os
import urllib.request
import urllib.error

SCHEMA = {
    "name": "query_business_report",
    "description": "查询真实业务报表并返回中文文字。每次查询都读取当前启用的非测试小组；可按全部、国家/部门或具体小组查询。分析表现、比较团队或提出优化建议时，可以分别查询小组、人员和渠道数据后综合判断。若同时给出 member 和 channel，会返回该人员在该渠道的交叉明细，禁止用金额相同等间接线索猜测归属。真实数值必须调用此工具，不得凭聊天记忆编造。未指定范围默认全部组、今天。",
    "parameters": {"type": "object", "properties": {
        "group": {"type": "string", "description": "查询范围；支持全部、美国/美国部/美国组、德国/德国部/德国组、新加坡/新加坡部/新加坡组，或当前启用的具体小组名称。不要根据旧聊天记忆列小组，先调用工具。"},
        "view": {"type": "string", "enum": ["summary", "members", "channels"], "description": "summary小组汇总；members人员汇总；channels渠道汇总"},
        "role": {"type": "string", "enum": ["all", "reception", "operator", "expert"], "description": "人员汇总岗位：all全部，reception接粉，operator炒群/群内负责人，expert专家"},
        "period": {"type": "string", "enum": ["today", "yesterday", "month", "lastMonth", "custom"]},
        "from": {"type": "string", "description": "custom时必填YYYY-MM-DD"},
        "to": {"type": "string", "description": "custom时必填YYYY-MM-DD"},
        "member": {"type": "string", "description": "可选：员工完整姓名。指定后自动查人员数据；与channel同时填写时查询该人员在该渠道的交叉数据。"},
        "channel": {"type": "string", "description": "可选：渠道名称。与member同时填写时返回人员×渠道的完整指标。"}
    }, "additionalProperties": False}
}

ORDER_SCHEMA = {
    "name": "query_customer_orders",
    "description": "只读查询真实客户号码。老板问某个号码何时接粉/开单、某组或某渠道的每个开单号码、FB 等渠道族的细分表现时必须调用本工具；不能用业务汇总猜号码。orders 逐号列出号码、接粉日期、开单日期、首充与渠道；channels 按具体渠道→小组→接粉月份拆分开单；phone 按完整号码或至少 6 位尾号查单个客户。默认本月，每页 15 条；更多记录继续查 page。只在已授权的老板群/私聊使用，不得转发到其他聊天。",
    "parameters": {"type": "object", "properties": {
        "view": {"type": "string", "enum": ["orders", "channels", "phone"], "description": "orders逐号明细；channels渠道细分；phone按号码查"},
        "group": {"type": "string", "description": "全部、美国部、德国部、新加坡部或完整小组名"},
        "period": {"type": "string", "enum": ["today", "yesterday", "month", "lastMonth", "custom"], "description": "按开单日期筛选；问指定月份时用custom的整月起止日期"},
        "from": {"type": "string", "description": "custom开始日期 YYYY-MM-DD"},
        "to": {"type": "string", "description": "custom结束日期 YYYY-MM-DD"},
        "channel": {"type": "string", "description": "具体渠道如 FB-M，或渠道族如 FB（匹配 FB-M、FB-Q 等）"},
        "phone": {"type": "string", "description": "完整客户号码或至少 6 位尾号；查号码时 view=phone"},
        "page": {"type": "integer", "minimum": 1, "maximum": 100, "description": "页码，默认 1"},
    }, "additionalProperties": False}
}

def query_report(args, **kwargs):
    token = os.environ.get("BOSS_QUERY_TOKEN", "")
    if not token:
        return json.dumps({"error": "查询连接尚未配置"}, ensure_ascii=False)
    if not isinstance(args, dict) or set(args) - set(SCHEMA["parameters"]["properties"]):
        return json.dumps({"error": "查询参数不正确"}, ensure_ascii=False)
    data = json.dumps(args, ensure_ascii=False).encode()
    if len(data)>4096:
        return json.dumps({"error": "查询内容过长"}, ensure_ascii=False)
    request=urllib.request.Request("http://127.0.0.1:4179/query", data=data, headers={"Authorization": "Bearer "+token, "Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(request,timeout=70) as response:
            return response.read(200000).decode()
    except urllib.error.HTTPError as error:
        if error.code in (400,429):
            return error.read(4096).decode()
        return json.dumps({"error":"报表查询暂时不可用，请稍后再试。"},ensure_ascii=False)
    except Exception:
        return json.dumps({"error":"报表查询暂时不可用，请稍后再试。"},ensure_ascii=False)

def query_orders(args, **kwargs):
    token = os.environ.get("BOSS_ORDER_QUERY_TOKEN", "")
    if not token:
        return json.dumps({"error": "号码查询尚未配置"}, ensure_ascii=False)
    if not isinstance(args, dict) or set(args) - set(ORDER_SCHEMA["parameters"]["properties"]):
        return json.dumps({"error": "查询参数不正确"}, ensure_ascii=False)
    data = json.dumps(args, ensure_ascii=False).encode()
    if len(data) > 4096:
        return json.dumps({"error": "查询内容过长"}, ensure_ascii=False)
    request = urllib.request.Request(
        "http://127.0.0.1:3003/api/integrations/boss-order-query",
        data=data,
        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.read(20000).decode()
    except urllib.error.HTTPError as error:
        if error.code in (400, 413, 429):
            return error.read(4096).decode()
        return json.dumps({"error": "号码查询暂时不可用，请稍后再试。"}, ensure_ascii=False)
    except Exception:
        return json.dumps({"error": "号码查询暂时不可用，请稍后再试。"}, ensure_ascii=False)

def register(ctx):
    ctx.register_tool(name="query_business_report",toolset="boss_reports",schema=SCHEMA,handler=query_report,description=SCHEMA["description"],emoji="📊")
    ctx.register_tool(name="query_customer_orders",toolset="boss_reports",schema=ORDER_SCHEMA,handler=query_orders,description=ORDER_SCHEMA["description"],emoji="📋")
