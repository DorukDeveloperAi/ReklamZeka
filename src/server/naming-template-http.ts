import { NextResponse } from "next/server";
import type { DrizzleNamingTemplateRepository, SaveNamingTemplateInput } from "@/connectors/campaigns/naming-template-drizzle-repository";
import type { DrizzleNamingTemplateReplayEvidenceRepository } from "@/connectors/campaigns/naming-template-replay-evidence-drizzle-repository";
import { NamingTemplateError } from "@/domain/campaigns/naming-template";

const headers=Object.freeze({"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","X-ReklamZeka-Access-Mode":"naming-template-evidence","X-ReklamZeka-Action-Authority":"none","X-ReklamZeka-Meta-Write":"disabled"});
const error=(status:number,code:string)=>NextResponse.json({error:{code}},{status,headers});
export const namingTemplateUnavailable=()=>error(503,"source_unavailable");
export const namingTemplateSessionRequired=()=>error(401,"local_session_required");
export const namingTemplateForbidden=()=>error(403,"forbidden");
export const namingTemplateInvalidInput=()=>error(400,"invalid_input");
const exact=(value:unknown,keys:readonly string[]):value is Record<string,unknown>=>Boolean(value)&&typeof value==="object"&&!Array.isArray(value)&&Object.keys(value as Record<string,unknown>).length===keys.length&&Object.keys(value as Record<string,unknown>).every(key=>keys.includes(key));
export type NamingTemplateOperation="list"|"save"|"preview";
export function namingTemplateRequestKind(request:Request):NamingTemplateOperation|null{
  let url:URL; try{url=new URL(request.url);}catch{return null;}
  if(request.headers.has("authorization")||request.headers.get("sec-fetch-site")!=="same-origin") return null;
  if(request.method==="GET"&&request.headers.get("x-reklamzeka-intent")==="naming-template-list"&&url.searchParams.size===1&&/^account_[a-f0-9]{24}$/.test(url.searchParams.get("account")??"")) return "list";
  if(url.search!==""||request.method!=="POST") return null;
  return request.headers.get("x-reklamzeka-intent")==="naming-template-save"?"save":request.headers.get("x-reklamzeka-intent")==="naming-template-preview"?"preview":null;
}
async function body(request:Request):Promise<unknown>{
  const length=Number(request.headers.get("content-length")??"0");
  if(!Number.isSafeInteger(length)||length<1||length>32768||!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return null;
  try{return await request.json();}catch{return null;}
}
function save(value:unknown,identity:Readonly<{workspaceId:string;actorId:string}>):SaveNamingTemplateInput|null{
  if(!exact(value,["accountRef","templateRef","commandRef","expectedRevision","state","namingFamily","entityLevel","nameRules","corroboration","proposedAssignments"])) return null;
  if(typeof value.accountRef!=="string"||typeof value.templateRef!=="string"||typeof value.commandRef!=="string"||!(value.expectedRevision===null||Number.isSafeInteger(value.expectedRevision))||!(value.state==="draft"||value.state==="published"||value.state==="disabled")||typeof value.namingFamily!=="string"||!(value.entityLevel==="campaign"||value.entityLevel==="ad_set")||!Array.isArray(value.nameRules)||!Array.isArray(value.corroboration)||!Array.isArray(value.proposedAssignments)) return null;
  return Object.freeze({...value,workspaceId:identity.workspaceId,actorId:identity.actorId}) as SaveNamingTemplateInput;
}
export function createNamingTemplateHttpHandlers(input:Readonly<{repository:Pick<DrizzleNamingTemplateRepository,"save"|"list">;replay:Pick<DrizzleNamingTemplateReplayEvidenceRepository,"replay">;identity(request:Request,operation:NamingTemplateOperation):Promise<Readonly<{workspaceId:string;actorId:string}>|null>}>){
  const invoke=async(request:Request)=>{
    const operation=namingTemplateRequestKind(request); if(!operation)return namingTemplateInvalidInput(); if(!request.headers.get("cookie"))return namingTemplateSessionRequired();
    try{
      const identity=await input.identity(request,operation); if(!identity)return namingTemplateForbidden();
      if(operation==="list")return NextResponse.json({items:await input.repository.list(identity.workspaceId,new URL(request.url).searchParams.get("account")!)},{headers});
      const value=await body(request); if(operation==="save"){
        const parsed=save(value,identity); if(!parsed)return namingTemplateInvalidInput(); const result=await input.repository.save(parsed);
        return NextResponse.json(result,{status:result.replay?200:201,headers});
      }
      if(!exact(value,["accountRef","templateRef","entityRef"])||typeof value.accountRef!=="string"||typeof value.templateRef!=="string"||typeof value.entityRef!=="string")return namingTemplateInvalidInput();
      const templates=await input.repository.list(identity.workspaceId,value.accountRef); const template=templates.filter(item=>item.templateRef===value.templateRef&&item.state==="published");
      if(template.length!==1)return namingTemplateInvalidInput();
      return NextResponse.json({result:await input.replay.replay({workspaceId:identity.workspaceId,template:template[0]!,entityRef:value.entityRef})},{headers});
    }catch(reason){
      if(reason instanceof NamingTemplateError)return reason.code==="invalid_input"||reason.code==="invalid_scope"?namingTemplateInvalidInput():reason.code==="invalid_revision"?error(409,"conflict"):namingTemplateUnavailable();
      return namingTemplateUnavailable();
    }
  }; return Object.freeze({GET:invoke,POST:invoke});
}
