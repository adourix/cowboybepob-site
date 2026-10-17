from pathlib import Path
p=Path('scripts/final-platform-patch.py')
s=p.read_text()
s=s.replace("pat=r\"customer\\.get\\('/services/:id/config', async \\(req:any\\) => \\{.*?\\n  \\}\\);\"", "pat=r\"customer\\.get\\('/services/:id/config', async \\(req:any\\) => \\{.*?return \\{link\\};\\s*\\}\\);\"")
# Add managed-provider credential handling for the remaining service-action provider call.
needle="w=w.replace(\"const provider=new MarzbanProvider(row.base_url,process.env.MARZBAN_USERNAME||'',process.env.MARZBAN_PASSWORD||'');\", \"if(!row.base_url||!row.credentials_enc) throw new Error('MARZBAN_PROVIDER_CREDENTIALS_MISSING'); const creds=JSON.parse(decrypt(row.credentials_enc)); const provider=new MarzbanProvider(row.base_url,creds.username,creds.password);\",1)"
if needle not in s:
    insert="w=w.replace(\"const provider=new MarzbanProvider(row.base_url,process.env.MARZBAN_USERNAME||'',process.env.MARZBAN_PASSWORD||'');\", \"if(!row.base_url||!row.credentials_enc) throw new Error('MARZBAN_PROVIDER_CREDENTIALS_MISSING'); const creds=JSON.parse(decrypt(row.credentials_enc)); const provider=new MarzbanProvider(row.base_url,creds.username,creds.password);\",1)\n"
    marker="wfile.write_text(w)"
    s=s.replace(marker,insert+marker)
# Make the new tools discoverable from the existing admin sidebar.
nav_marker="if '/admin/services/manual' not in x:"
if nav_marker in s and "إضافة خدمة" not in s:
    s=s.replace("if '/admin/services/manual' not in x:\n", "x=x.replace(\"const nav=[['/admin','نظرة عامة',LayoutDashboard],\", \"const nav=[['/admin','نظرة عامة',LayoutDashboard],['/admin/services/manual','إضافة خدمة',Plus],['/admin/catalog/manage','إدارة الكتالوج',Package],\")\nif '/admin/services/manual' not in x:\n")
# Fix implicit-any callbacks in the generated admin tools page.
marker="print('platform patch applied')"
fix="tools=root/'apps/web/src/admin-tools.tsx'\nt=tools.read_text()\nt=t.replace('plans.map(p=>','plans.map((p:any)=>').replace('rs.map(r=>','rs.map((r:any)=>')\ntools.write_text(t)\n"
if fix not in s:
    s=s.replace(marker,fix+marker)
# Fix the service listing query to actually join routers.
join_fix="a=a.replace(\"LEFT JOIN subscriptions sub ON sub.service_id=s.id LEFT JOIN service_allocations\", \"LEFT JOIN subscriptions sub ON sub.service_id=s.id LEFT JOIN routers r ON r.id=s.router_id LEFT JOIN service_allocations\")\n"
if join_fix not in s:
    s=s.replace(marker,join_fix+fix+marker)
# Fix manual config insert parameter count.
param_fix="a=a.replace(\"JSON.stringify({...parsed.params,address:parsed.address,port:parsed.port}),encryptSecret(String(b.link).trim())\", \"JSON.stringify({...parsed.params,address:parsed.address,port:parsed.port}),encryptSecret(String(b.link).trim())\")\n"
# The generated route currently has an extra literal env-v1 argument in its values array; remove that exact occurrence.
s=s.replace("encryptSecret(parsed.uuid),'env-v1',JSON.stringify({...parsed.params,address:parsed.address,port:parsed.port}),encryptSecret(String(b.link).trim())", "encryptSecret(parsed.uuid),JSON.stringify({...parsed.params,address:parsed.address,port:parsed.port}),encryptSecret(String(b.link).trim())")
p.write_text(s)
print('patch runner fixed')
