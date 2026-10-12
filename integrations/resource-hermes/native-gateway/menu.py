"""Set only business-safe native commands; token is loaded by the service environment."""
import json, os, urllib.request
COMMANDS=[('new','新建对话'),('help','功能与使用说明'),('status','当前对话状态'),('stop','停止本次回答'),
 ('effects','本月投流效果'),('sms','本月短信效果'),('orders','本月开单号码'),('next','查询下一页'),
 ('resource_excel','导出上一份查询为 Excel'),('whoami','查看我的电报身份')]
def call(method, body):
    request=urllib.request.Request('https://api.telegram.org/bot'+os.environ['TELEGRAM_BOT_TOKEN']+'/'+method,
        data=json.dumps(body).encode(),headers={'Content-Type':'application/json'})
    try:
        with urllib.request.urlopen(request,timeout=20) as response: result=json.loads(response.read())
    except Exception: raise RuntimeError('Telegram menu request failed') from None
    if not result.get('ok'): raise RuntimeError('Telegram rejected menu configuration')
    return result['result']
def main():
    assert call('getMe',{})['username']=='ziyuanfeicanmou_bot'
    scopes=[{'type': t} for t in ('default','all_private_chats','all_group_chats')]
    scopes += [{'type':'chat','chat_id':int(cid)} for cid in [os.environ['RESOURCE_GROUP_CHAT_ID'],*os.environ['RESOURCE_PRIVATE_USER_IDS'].split(',')]]
    commands=[{'command':name,'description':description} for name,description in COMMANDS]
    for scope in scopes:
        for lang in ('','zh'):
            args={'scope':scope,'language_code':lang}
            call('setMyCommands',{**args,'commands':commands})
            assert call('getMyCommands',args)==commands
    call('setChatMenuButton',{'menu_button':{'type':'commands'}})
    print(json.dumps({'nativeBusinessCommands':len(commands),'verifiedMenuScopes':len(scopes)*2,'messagesSent':0}))
if __name__=='__main__': main()
