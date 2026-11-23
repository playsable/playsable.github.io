"use strict";
const form=document.querySelector("#affiliate-form");
const button=form.querySelector("button[type=submit]");
const status=document.querySelector("#submit-status");
const endpoint="https://cbabwpvvwerumifvbema.supabase.co/functions/v1/affiliate-apply";
// Public Supabase anon key; database rows are not accessible with this key.
const anonKey="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNiYWJ3cHZ2d2VydW1pZnZiZW1hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ4OTgyOTUsImV4cCI6MjExMDQ3NDI5NX0.1ICtyaSMqcjWV6bd7raBGb7WDxlRKOLfJEoPscPER3U";
button.disabled=false;
const show=(state,message)=>{status.dataset.state=state;status.textContent=message;};
form.addEventListener("submit",async event=>{
  event.preventDefault();
  if(button.disabled || !form.reportValidity()) return;
  const fields=new FormData(form);
  const value=key=>String(fields.get(key)||"").trim();
  const body={name:value("name"),email:value("email"),channel:value("channel"),kind:value("kind"),
    pitch:value("pitch"),adult:fields.get("adult")==="on",website:value("website")};
  button.disabled=true;show("pending","Sending your application…");
  let saved=false;
  try{
    const response=await fetch(endpoint,{method:"POST",headers:{"content-type":"application/json",apikey:anonKey,
      authorization:"Bearer "+anonKey},credentials:"omit",body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
    if(response.status===400){show("error","Check the fields. Use a public channel link that starts with https:// or http://, and include a short pitch.");return;}
    if(response.status===429){show("error","The form is busy right now. Give it a little time, then try again.");return;}
    if(!response.ok || (await response.json()).ok!==true) throw new Error("Submission not confirmed");
    saved=true;form.reset();show("success","Application received. If there’s a fit, we’ll contact you at the email you provided.");
  } catch {show("error","We couldn’t confirm your application. Your answers are still here. Please try again.");}
  finally{button.disabled=saved;status.focus();}
});
