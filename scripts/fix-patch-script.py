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
p.write_text(s)
print('patch runner fixed')
