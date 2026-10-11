#!/usr/bin/env node
// Real Pi resource loading, worker dispatch and optional bounded historical sample.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const piRoot = process.env.PI_VERIFY_SDK_ROOT;
if (!piRoot) throw new Error("Set PI_VERIFY_SDK_ROOT to the installed Pi package root");
const { DefaultResourceLoader, SettingsManager } = await import(pathToFileURL(join(piRoot, "dist/index.js")));
const root = mkdtempSync(join(tmpdir(), "pi-literal-runtime-"));
const packageRoot = resolve(import.meta.dirname, "..");
let extension;
const context = { cwd:root, hasUI:false, ui:{notify:()=>{},setStatus:()=>{}}, sessionManager:{getEntries:()=>[]} };
try {
  const source = process.argv[2];
  const query = process.argv[3] ?? "cover-skill";
  const before = process.argv[4];
  let lines;
  if (source) {
    // Preserve original development events only; later resume messages can hide an indexing defect.
    lines = readFileSync(source, "utf8").trim().split("\n").filter(line => {
      try { const e=JSON.parse(line); return !before || !e.timestamp || e.timestamp < before; } catch { return false; }
    });
  } else {
    lines = [JSON.stringify({type:"session",version:3,id:"literal-runtime",timestamp:"2026-01-01T00:00:00Z",cwd:root}),
      JSON.stringify({type:"message",message:{role:"user",content:[{type:"text",text:"create a cover tool"}]}}),
      JSON.stringify({type:"message",message:{role:"toolResult",toolName:"codemode",nestedCalls:{calls:[{name:"write",status:"ok",arguments:{path:"/projects/cover-skill/PLAN.md"}}]}}})];
  }
  const header=JSON.parse(lines[0]);
  const sessions=join(root,"sessions","--fixture--");
  const base=join(root,"base");
  mkdirSync(sessions,{recursive:true});mkdirSync(base,{recursive:true});mkdirSync(join(root,".pi"),{recursive:true});
  writeFileSync(join(sessions,"fixture.jsonl"),lines.join("\n"));
  writeFileSync(join(root,".pi","settings.json"),JSON.stringify({"pi-session-search":{localPath:base}}));
  writeFileSync(join(base,"config.json"),JSON.stringify({sessionDir:join(root,"sessions"),archiveDir:join(root,"archive"),sync:{interval:-1,initialDelay:-1,disableForChild:false}}));
  const loader = new DefaultResourceLoader({cwd:root,agentDir:join(root,"agent"),settingsManager:SettingsManager.inMemory({packages:[]}),noExtensions:true,additionalExtensionPaths:[join(packageRoot,"dist/index.js")],additionalSkillPaths:[join(packageRoot,"skills/session-history")],noThemes:true,noPromptTemplates:true,noContextFiles:true});
  await loader.reload();
  const loaded=loader.getExtensions();assert.deepEqual(loaded.errors,[]);
  extension=loaded.extensions.find(e=>e.tools.has("session_search"));assert.ok(extension);
  assert.ok(loader.getSkills().skills.some(s=>s.name==="session-history"));
  for(const handler of extension.handlers.get("session_start")??[])await handler({type:"session_start",reason:"startup"},context);
  const tool=extension.tools.get("session_search").definition;
  assert.ok(tool.parameters.properties.mode);
  let result;
  for(let i=0;i<50;i++){
    result=await tool.execute("verify",{query,mode:"literal"});
    if(result.details?.resultCount)break;
    await new Promise(r=>setTimeout(r,20));
  }
  assert.equal(result.details.resultCount,1);
  assert.ok(result.content[0].text.includes("ID: "+header.id));
  assert.ok(result.content[0].text.includes("CWD: "+header.cwd));
  console.log(JSON.stringify({kind:"real-pi-resource-and-worker",result:"PASS",mode:"literal",matches:result.details.resultCount,indexed:result.details.indexSize,skill_discovered:true,history_sample:!!source,model_requests:0}));
} finally {
  for(const handler of extension?.handlers.get("session_shutdown")??[])await handler({type:"session_shutdown"},context);
  rmSync(root,{recursive:true,force:true});
}
