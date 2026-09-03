import express from "express";
import multer from "multer";
import fs from "fs/promises";
import path from "path";
import OpenAI from "openai";
import { fileURLToPath } from "url";

const __filename=fileURLToPath(import.meta.url);
const __dirname=path.dirname(__filename);
const app=express();
const upload=multer({dest:path.join(__dirname,"tmp"),limits:{fileSize:20*1024*1024}});
const openai=new OpenAI({apiKey:process.env.OPENAI_API_KEY});
const PORT=process.env.PORT||3000;
const MEMORY_FILE=path.join(__dirname,"memory.json");

app.use(express.json({limit:"1mb"}));
app.use(express.static(__dirname));

async function readMemory(){
  try{return JSON.parse(await fs.readFile(MEMORY_FILE,"utf8"))}catch{return {}}
}
async function writeMemory(m){await fs.writeFile(MEMORY_FILE,JSON.stringify(m,null,2),"utf8")}
function compactHistory(h){return h.slice(-18)}

app.post("/api/chat",async(req,res)=>{
  try{
    const {message,sessionId="default"}=req.body||{};
    if(!message) return res.status(400).json({error:"message required"});
    const memory=await readMemory();
    const history=memory[sessionId]?.history||[];
    const input=[
      ...compactHistory(history).map(x=>({role:x.role,content:x.content})),
      {role:"user",content:message}
    ];
    const response=await openai.responses.create({
      model:"gpt-5.6",
      instructions:"Ты — Старина, личный умный собеседник Димы. Говори по-русски. Тон: спокойный, зрелый, дружеский, уважительный, уверенный. Не изображай человека и не утверждай, что ты физически присутствуешь. Помни контекст текущего разговора. Отвечай обычно кратко и по делу.",
      input,
      store:false
    });
    const reply=response.output_text||"Я здесь.";
    memory[sessionId]={updatedAt:new Date().toISOString(),history:compactHistory([...history,{role:"user",content:message},{role:"assistant",content:reply}])};
    await writeMemory(memory);
    res.json({reply});
  }catch(e){res.status(500).json({error:e.message})}
});

app.post("/api/transcribe",upload.single("audio"),async(req,res)=>{
  try{
    if(!req.file) return res.status(400).json({error:"audio required"});
    const f=await import("fs");
    const transcription=await openai.audio.transcriptions.create({
      file:f.createReadStream(req.file.path),
      model:"gpt-4o-transcribe",
      language:"ru"
    });
    await fs.unlink(req.file.path).catch(()=>{});
    res.json({text:transcription.text});
  }catch(e){
    if(req.file) await fs.unlink(req.file.path).catch(()=>{});
    res.status(500).json({error:e.message});
  }
});

app.post("/api/speak",async(req,res)=>{
  try{
    const text=(req.body?.text||"").slice(0,3800);
    const audio=await openai.audio.speech.create({
      model:"gpt-4o-mini-tts",
      voice:"cedar",
      input:text,
      instructions:"Говори по-русски низким, спокойным, зрелым мужским голосом. Тепло, уверенно, без театральности.",
      response_format:"mp3"
    });
    const buf=Buffer.from(await audio.arrayBuffer());
    res.setHeader("Content-Type","audio/mpeg");
    res.send(buf);
  }catch(e){res.status(500).json({error:e.message})}
});

app.get("/api/health",(req,res)=>res.json({ok:true,apiKey:Boolean(process.env.OPENAI_API_KEY)}));

app.listen(PORT,()=>console.log(`Starina / ABIOMA: http://localhost:${PORT}`));
