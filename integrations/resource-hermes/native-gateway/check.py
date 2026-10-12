import contextlib, json, os, sys, uuid
from pathlib import Path
import logging
logging.disable(logging.CRITICAL)
with open(os.devnull,'w') as sink, contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
    from run_agent import AIAgent
    from gateway.config import load_gateway_config, Platform
    from gateway.session import SessionSource
    from gateway.platforms.base import MessageEvent, validate_media_delivery_path
    from gateway.session_context import set_session_vars, clear_session_vars
    from hermes_cli.lifecycle import invoke_hook
    from gateway.slash_access import policy_for_source
    from hermes_cli.commands_platforms import telegram_menu_commands
    config = load_gateway_config()
    uid='8387614254'; group='-5133647199'
    source=SessionSource(platform=Platform.TELEGRAM, chat_id=uid, user_id=uid, chat_type='dm', message_id='912001')
    text='查询本月投流效果和本月短信效果，分别保留真实结果，合成一份 Excel 对比表。只简短说明是否有记录，不要改成开单号码报表。'
    event=MessageEvent(text=text, source=source,message_id=source.message_id)
    tokens=set_session_vars(platform='telegram', chat_id=uid, user_id=uid, chat_type='dm', message_id=source.message_id)
    agent=AIAgent(provider='deepseek', model='deepseek-v4-flash', base_url='https://api.deepseek.com/v1',api_key=os.environ['DEEPSEEK_API_KEY'],
        enabled_toolsets=['resource_reports'], max_iterations=12,max_tokens=2600,
        quiet_mode=True,verbose_logging=False,save_trajectories=False,session_id='native-check-'+str(uuid.uuid4()),platform='telegram',
        user_id=uid,chat_id=uid,chat_type='dm',run_budget_seconds=140,load_soul_identity=True)
    allowed={'query_resource_report','describe_resource_scope','create_resource_workbook'}
    assert agent.valid_tool_names == allowed, sorted(agent.valid_tool_names)
    assert not agent._memory_enabled and not agent._user_profile_enabled
    policy=policy_for_source(config,source)
    assert policy.enabled and policy.can_run(uid,'new') and not policy.can_run(uid,'update') and not policy.can_run(uid,'model'), str(policy)
    group_source=SessionSource(platform=Platform.TELEGRAM,chat_id=group,user_id='12345',chat_type='group',message_id='912002')
    gp=policy_for_source(config,group_source)
    assert gp.enabled and not gp.can_run('12345','terminal')
    # Exercise the actual loaded plugin hooks without sending any Telegram message.
    results=invoke_hook('pre_gateway_dispatch',event=event,gateway=None,session_store=None)
    assert not any(isinstance(r,dict) and r.get('action')=='skip' for r in results),results
    assert any(isinstance(r,dict) and r.get('action')=='block' for r in invoke_hook('pre_tool_call',tool_name='terminal',args={})), 'tool guard missing'
    bad=MessageEvent(text='hello',source=SessionSource(platform=Platform.TELEGRAM,chat_id='12345',user_id='12345',chat_type='dm',message_id='4'))
    assert any(isinstance(r,dict) and r.get('action')=='skip' for r in invoke_hook('pre_gateway_dispatch',event=bad,gateway=None,session_store=None))
    for scope_source in (source,group_source):
        bad_command=MessageEvent(text='/update',source=scope_source,message_id=scope_source.message_id)
        assert any(isinstance(r,dict) and r.get('text')=='/resource_help' for r in invoke_hook('pre_gateway_dispatch',event=bad_command,gateway=None,session_store=None))
    invoke_hook('pre_gateway_dispatch',event=event,gateway=None,session_store=None)
    menu=[n for n,_ in telegram_menu_commands(max_commands=11)[0]]
    assert set(menu) == {'new','help','status','stop','effects','sms','orders','next','resource_excel','whoami','resource_help'},menu
    result=agent.run_conversation(text)
    assert result.get('completed') is not False,result.get('error')
    messages=result.get('messages',[])
    calls=[]; responses=[]
    for m in messages:
        for c in m.get('tool_calls',[]): calls.append(c.get('function',{}).get('name'))
        if m.get('role')=='tool':
            try: responses.append(json.loads(m.get('content','{}')))
            except Exception: pass
    queried=[r for r in responses if r.get('query')]
    assert {r['query']['type'] for r in queried} >= {'ADS','SMS'}, [r.get('error') for r in responses]
    assert all(r['query']['view']=='effects' for r in queried)
    exports=[r for r in responses if r.get('media') and r.get('reportCount')==2]
    assert exports, {'calls':calls,'errors':[r.get('error') for r in responses]}
    media=exports[-1]['media'];path=media.removeprefix('MEDIA:')
    assert Path(path).is_file()
    assert media in result.get('final_response',''), 'Native response omitted attachment'
    assert validate_media_delivery_path(path)==path
    assert validate_media_delivery_path(str(Path(os.environ['HERMES_HOME'])/'config.yaml')) is None
    assert validate_media_delivery_path('/etc/passwd') is None
    # Validate the file as a workbook, not just a generated path.
    import zipfile, xml.etree.ElementTree as ET, asyncio
    with zipfile.ZipFile(path) as z:
        sheets=[n for n in z.namelist() if n.startswith('xl/worksheets/sheet') and n.endswith('.xml')]
        sheet_count=len(sheets)
        assert sheet_count>=5
        for name in sheets:
            tree=ET.fromstring(z.read(name))
            assert not tree.findall('.//{*}f'), 'unexpected formulas'
    # Native session reset changes only this conversation. No Telegram adapters are connected.
    from gateway.run import GatewayRunner
    runner=GatewayRunner(config)
    assert runner._is_user_authorized(source)
    assert runner._is_user_authorized(group_source)
    assert not runner._is_user_authorized(bad.source)
    async def reset_check():
        one=await runner.async_session_store.get_or_create_session(source)
        other=await runner.async_session_store.get_or_create_session(group_source)
        old=one.session_id; other_id=other.session_id
        await runner._handle_reset_command(MessageEvent(text='/new',source=source,message_id='912003'))
        new=await runner.async_session_store.get_or_create_session(source)
        unchanged=await runner.async_session_store.get_or_create_session(group_source)
        assert new.session_id!=old and unchanged.session_id==other_id
    asyncio.run(reset_check())
    # Exercise actual plugin + read-only bridge for another group member.
    clear_session_vars(tokens)
    tokens=set_session_vars(platform='telegram',chat_id=group,user_id='12345',chat_type='group',message_id='912002',session_id='native-group-check')
    ge=MessageEvent(text='查询本月投流效果',source=group_source,message_id='912002')
    invoke_hook('pre_gateway_dispatch',event=ge,gateway=None,session_store=None)
    plugin=next(m for m in list(sys.modules.values()) if getattr(m,'__file__','') and str(m.__file__).endswith('plugins/resource-reports/__init__.py'))
    group_result=json.loads(plugin.request('/query',{'view':'effects','type':'ADS','period':'month','excel':False}))
    assert group_result.get('query',{}).get('type')=='ADS',group_result.get('error')
    agent.close();clear_session_vars(tokens)
print(json.dumps({'nativeTools':sorted(allowed),'nativeMenu':menu,'privateAndGroupCommandRestrictions':True,
    'unauthorizedPrivateDenied':True,'queries':[{'type':r['query']['type'],'view':r['query']['view'],'rows':r['recordCount']} for r in queried],
    'workbookSheets':sheet_count,'nativeAttachmentRecognized':True,'hostFilesDenied':True,'nativeResetIsolated':True,'groupMemberQueryVerified':True,'telegramMessagesSent':0},ensure_ascii=False))
