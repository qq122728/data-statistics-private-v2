import importlib.util
s=importlib.util.spec_from_file_location('daily','integrations/data-reports/group_daily_report.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
def row(i,deps=[]):return {'groupId':i,'date':'2026-10-12','ready':True,'text':'ok','dependencies':deps}
payload={'results':[row('country:DE',['a:2026-10-12','b:2026-10-12']),row('a'),row('b')]}
state={'sent':{}};sent=[]
def send(body):
 assert state['sent'][body['groupId']+':'+body['date']]['status']=='sending'
 sent.append(body['groupId']);return {'delivered':True,'format':'rich'}
m.deliver_ready(payload,state,lambda s:None,send)
assert sent==['a','b','country:DE'];m.deliver_ready(payload,state,lambda s:None,send);assert len(sent)==3
state={'sent':{'a:2026-10-12':{'status':'uncertain'}}};sent=[];m.deliver_ready(payload,state,lambda s:None,send);assert sent==['b']
print('scheduler ordering, durable claim and uncertain dependency tests passed')
