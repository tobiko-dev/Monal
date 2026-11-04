// Test-only scripted XMPP peer. No real accounts, persistence or forwarding.
// The test client uses upstream nbxmpp; this narrowly recognizes its fixtures.
export const SCENARIOS = Object.freeze(["success", "bad-subprotocol", "malformed", "entity",
  "binary", "oversized", "wrong-domain", "auth-failure", "bad-signature", "interrupt-auth", "stall-auth"]);
const DOMAIN = "example.invalid", PASSWORD = "synthetic-only";
const FRAMING = "urn:ietf:params:xml:ns:xmpp-framing";
const SASL = "urn:ietf:params:xml:ns:xmpp-sasl";
const utf8 = new TextEncoder();
const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const un64 = (value) => Uint8Array.from(atob(value), c => c.charCodeAt(0));
const digest = (bytes) => crypto.subtle.digest("SHA-256", bytes);
async function mac(key, bytes) {
  return crypto.subtle.sign("HMAC", await crypto.subtle.importKey("raw", key,
    {name:"HMAC",hash:"SHA-256"},false,["sign"]), bytes);
}
const field = (text, name) => new RegExp(`\\b${name}=["']([^"']+)["']`).exec(text)?.[1];
const textValue = (text) => />([^<]*)<\//.exec(text)?.[1] ?? "";

export function attachPeer(socket, scenario) {
  if (!SCENARIOS.includes(scenario)) throw new Error("Invalid synthetic scenario");
  let phase="first-open", clientBare, serverFirst, nonce, salted;
  let ended=false, count=0, pending=0;
  let sequence=Promise.resolve();
  const end=()=>{ if(ended)return;ended=true;clearTimeout(timer);try{socket.close(1000);}catch{} };
  const timer=setTimeout(end,45000);
  if (scenario === "bad-subprotocol") { setTimeout(end, 50); }
  const send=(text)=>{if(!ended)socket.send(text);};
  async function receive(xml) {
    if(ended)return;
    if(typeof xml!=="string" || xml.length>65536 || ++count>40){end();return;}
    if(/^<close\b/.test(xml)){send(`<close xmlns="${FRAMING}"/>`);end();return;}
    if(/^<abort\b/.test(xml)){send(`<failure xmlns="${SASL}"><aborted/></failure>`);return;}
    if(phase==="first-open" && /^<open\b/.test(xml)) {
      if(field(xml,"to")!==DOMAIN){end();return;}
      if(scenario==="binary"){socket.send(new Uint8Array([1,2,3]));return;}
      if(scenario==="oversized"){send("x".repeat(1024*1024+1));return;}
      if(scenario==="malformed"){send("<open><broken></open>");return;}
      if(scenario==="entity"){send('<!DOCTYPE x [<!ENTITY bad SYSTEM "file:///synthetic-private">]><x>&bad;</x>');return;}
      send(`<open xmlns="${FRAMING}" from="${scenario==="wrong-domain" ? "wrong.invalid" : DOMAIN}" id="synthetic-stream" version="1.0"/>`);
      send(`<stream:features xmlns:stream="http://etherx.jabber.org/streams"><mechanisms xmlns="${SASL}"><mechanism>SCRAM-SHA-256</mechanism></mechanisms></stream:features>`);
      phase="auth";return;
    }
    if(phase==="auth" && /^<auth\b/.test(xml)) {
      if(field(xml,"mechanism")!=="SCRAM-SHA-256"){end();return;}
      if(scenario==="interrupt-auth"){end();return;}
      if(scenario==="stall-auth")return;
      if(scenario==="auth-failure"){send(`<failure xmlns="${SASL}"><not-authorized/><text>synthetic-private-server-text</text></failure>`);return;}
      const first=new TextDecoder("utf-8",{fatal:true}).decode(un64(textValue(xml)));
      if(!/^n,,n=synthetic,r=[A-Za-z0-9+/=]+$/.test(first)){end();return;}
      clientBare=first.slice(3);nonce=first.split(",r=")[1]+b64(crypto.getRandomValues(new Uint8Array(16)));
      const salt=crypto.getRandomValues(new Uint8Array(16));
      serverFirst=`r=${nonce},s=${b64(salt)},i=4096`;
      const key=await crypto.subtle.importKey("raw",utf8.encode(PASSWORD),"PBKDF2",false,["deriveBits"]);
      salted=await crypto.subtle.deriveBits({name:"PBKDF2",hash:"SHA-256",salt,iterations:4096},key,256);
      phase="response";send(`<challenge xmlns="${SASL}">${b64(utf8.encode(serverFirst))}</challenge>`);return;
    }
    if(phase==="response" && /^<response\b/.test(xml)) {
      const final=new TextDecoder("utf-8",{fatal:true}).decode(un64(textValue(xml)));
      const prefix=`c=biws,r=${nonce}`;
      if(!final.startsWith(prefix+",p=")){end();return;}
      const message=utf8.encode(`${clientBare},${serverFirst},${prefix}`);
      const clientKey=new Uint8Array(await mac(salted,utf8.encode("Client Key")));
      const signature=new Uint8Array(await mac(await digest(clientKey),message));
      const proof=un64(final.slice(prefix.length+3));let difference=proof.length^clientKey.length;
      for(let i=0;i<clientKey.length;i++)difference|=(proof[i]??0)^(clientKey[i]^signature[i]);
      if(difference){end();return;}
      const serverSignature=await mac(await mac(salted,utf8.encode("Server Key")),message);
      const value=scenario==="bad-signature" ? b64(new Uint8Array(32)) : b64(serverSignature);
      phase="second-open";send(`<success xmlns="${SASL}">${b64(utf8.encode("v="+value))}</success>`);return;
    }
    if(phase==="second-open" && /^<open\b/.test(xml)) {
      send(`<open xmlns="${FRAMING}" from="${DOMAIN}" id="synthetic-restarted-stream" version="1.0"/>`);
      send('<stream:features xmlns:stream="http://etherx.jabber.org/streams"><bind xmlns="urn:ietf:params:xml:ns:xmpp-bind"/></stream:features>');phase="bind";return;
    }
    if(phase==="bind" && /^<iq\b/.test(xml) && xml.includes("<bind")) {
      const id=field(xml,"id"); if(!id || !/^[A-Za-z0-9_-]{1,100}$/.test(id)){end();return;}
      send(`<iq xmlns="jabber:client" type="result" id="${id}"><bind xmlns="urn:ietf:params:xml:ns:xmpp-bind"><jid>synthetic@${DOMAIN}/browser-qa</jid></bind></iq>`);phase="active";return;
    }
    if(phase==="active" && /^<iq\b/.test(xml) && xml.includes("urn:xmpp:ping")) {
      const id=field(xml,"id");if(!id || !/^[A-Za-z0-9_-]{1,100}$/.test(id)){end();return;}
      send(`<iq xmlns="jabber:client" type="result" id="${id}" from="${DOMAIN}" to="synthetic@${DOMAIN}/browser-qa"/>`);return;
    }
    // Never accept user messages or act as a relay.
    end();
  }
  socket.addEventListener("message", ({data})=>{
    if(++pending>8){end();return;}
    sequence=sequence.then(()=>receive(data)).catch(end).finally(()=>pending--);
  });
  socket.addEventListener("close",end);socket.addEventListener("error",end);
  return end;
}
