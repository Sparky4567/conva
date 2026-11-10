import { useEffect, useRef, useState } from 'react';
import type { Chat, Message, User, Signal } from '../shared/types';
import { Icon } from './Icons';
import './index.css';
import { Auth } from './Auth';
import { Account } from './Account';
import { type CurrentUser } from './api';
const initials = (s: string) => s.split(' ').map(x => x[0]).slice(0, 2).join('');
function Avatar({user, group=false, small=false, online=false}:{user?:User;group?:boolean;small?:boolean;online?:boolean}) { return <span className={`avatar ${small ? 'small' : ''} ${group ? 'group' : ''}`} style={{background:user?.color}}>{group ? <Icon name="users" size={24}/> : initials(user?.name || '?')}{online && <i/>}</span> }
export function App() {
 const [user, setUser] = useState<CurrentUser | null>(null);
 const [loading, setLoading] = useState(true);
 const [error, setError] = useState('');
 const restoreAttempt = useRef(0);
 async function restore() {
  const attempt = ++restoreAttempt.current;
  setLoading(true);
  setError('');
  try {
   const response = await fetch('/api/auth/session', { credentials: 'same-origin' });
   if (attempt !== restoreAttempt.current) return;
   if (response.status === 401) { setUser(null); return; }
   if (!response.ok) throw new Error('Could not restore your session.');
   const result = await response.json();
   if (attempt === restoreAttempt.current) setUser(result.user);
  } catch {
   if (attempt === restoreAttempt.current) setError('Could not connect to the server. Please try again.');
  } finally {
   if (attempt === restoreAttempt.current) setLoading(false);
  }
 }
 useEffect(() => {
  try { localStorage.removeItem('skype-user'); } catch { /* Legacy storage may be disabled. */ }
  restore();
  return () => { restoreAttempt.current++; };
 }, []);
 if (loading) return <main className="session-loading" role="status">Connecting to Skype…</main>;
 if (error) return <main className="session-loading"><p role="alert">{error}</p><button className="primary" onClick={restore}>Try again</button></main>;
 return user ? <AuthenticatedApp key={user.id} currentUser={user} onSignedOut={() => setUser(null)}/> : <Auth onAuthenticated={setUser}/>;
}
function AuthenticatedApp({currentUser,onSignedOut}:{currentUser:CurrentUser;onSignedOut():void}) {
 const identity=currentUser.id;
 const [users,setUsers]=useState<User[]>([]),[chats,setChats]=useState<Chat[]>([]),[messages,setMessages]=useState<Message[]>([]),[online,setOnline]=useState<string[]>([]);
 const [selected,setSelected]=useState(''),[connected,setConnected]=useState(false),[search,setSearch]=useState(''),[draft,setDraft]=useState(''),[tab,setTab]=useState('Chats');
 const [modal,setModal]=useState(''),[members,setMembers]=useState<string[]>([]),[groupName,setGroupName]=useState(''),[details,setDetails]=useState(false),[emoji,setEmoji]=useState(false),[notice,setNotice]=useState(''),[typing,setTyping]=useState<Record<string,number>>({});
 const [call,setCall]=useState<{peer:string;video:boolean;status:string}|null>(null),[incoming,setIncoming]=useState<Signal|null>(null),[muted,setMuted]=useState(false),[camera,setCamera]=useState(true);
 const socket=useRef<WebSocket|null>(null),bottom=useRef<HTMLDivElement>(null),pc=useRef<RTCPeerConnection|null>(null),stream=useRef<MediaStream|null>(null),localVideo=useRef<HTMLVideoElement>(null),remoteVideo=useRef<HTMLVideoElement>(null),pendingIce=useRef<RTCIceCandidateInit[]>([]),callPeer=useRef(''),lastTyping=useRef(0);
 const notify=(text:string)=>{setNotice(text);setTimeout(()=>setNotice(''),5000)};
 const send=(event:object)=>{if(socket.current?.readyState===WebSocket.OPEN){socket.current.send(JSON.stringify(event));return true}notify('Connection lost. Please wait while we reconnect.');return false};
 function cleanup(){pc.current?.close();pc.current=null;stream.current?.getTracks().forEach(t=>t.stop());stream.current=null;pendingIce.current=[];callPeer.current='';setCall(null);setIncoming(null);setMuted(false);setCamera(true)}
 async function setup(peer:string,video:boolean){
  callPeer.current=peer;
  const media=await navigator.mediaDevices.getUserMedia({audio:true,video});stream.current=media;
  const connection=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}]});pc.current=connection;
  media.getTracks().forEach(t=>connection.addTrack(t,media));
  connection.onicecandidate=e=>{if(e.candidate)send({type:'ice',to:peer,data:e.candidate.toJSON()})};
  connection.ontrack=e=>{if(remoteVideo.current)remoteVideo.current.srcObject=e.streams[0] || new MediaStream([e.track])};
  connection.onconnectionstatechange=()=>{if(connection.connectionState==='connected')setCall(c=>c?{...c,status:'Connected'}:null);if(['failed','disconnected'].includes(connection.connectionState)){notify('Call connection ended.');cleanup()}};
  if(localVideo.current)localVideo.current.srcObject=media;
  return connection;
 }
 async function signal(s:Signal){
  if(s.type==='offer'){if(callPeer.current){send({type:'decline',to:s.from});return}callPeer.current=s.from || '';setIncoming(s);return}
  if(s.from!==callPeer.current)return;
  if(s.type==='answer' && pc.current){await pc.current.setRemoteDescription(s.data);for(const ice of pendingIce.current)await pc.current.addIceCandidate(ice);pendingIce.current=[]}
  if(s.type==='ice'){if(pc.current?.remoteDescription)await pc.current.addIceCandidate(s.data);else pendingIce.current.push(s.data)}
  if(s.type==='hangup'||s.type==='decline'){notify(s.type==='decline'?'Call declined.':'Call ended.');cleanup()}
 }
 useEffect(()=>{
  let disposed=false,timer:ReturnType<typeof setTimeout>;
  const connect=()=>{
   const ws=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws`);socket.current=ws;
   ws.onopen=()=>{if(!disposed)setConnected(true)};
   ws.onmessage=e=>{if(disposed)return;const event=JSON.parse(e.data);if(event.type==='unauthorized'){onSignedOut();return}if(event.type==='error')notify(event.message);if(event.type==='init'){setUsers(event.users);setChats(event.chats);setMessages(event.messages);setOnline(event.online);setSelected(s=>event.chats.some((c:Chat)=>c.id===s)?s:event.chats[0]?.id || '')}if(event.type==='presence')setOnline(event.online);if(event.type==='message')setMessages(m=>m.some(x=>x.id===event.message.id)?m:[...m,event.message]);if(event.type==='chat'){setChats(c=>c.some(x=>x.id===event.chat.id)?c:[...c,event.chat]);setSelected(event.chat.id)}if(event.type==='typing')setTyping(t=>({...t,[event.chatId]:Date.now()}));if(event.type==='signal')signal(event.signal).catch(()=>{notify('Could not connect the call.');cleanup()})};
   ws.onclose=async(event)=>{
    if(disposed)return;
    setConnected(false);
    if(event.code===4001){onSignedOut();return}
    try {
     const response=await fetch('/api/auth/session',{credentials:'same-origin'});
     if(disposed)return;
     if(response.status===401){onSignedOut();return}
     if(response.ok){const result=await response.json();if(disposed)return;if(result.user.id!==identity){onSignedOut();return}}
    }catch{}
    if(!disposed)timer=setTimeout(connect,1500);
   };
  };connect();return()=>{disposed=true;clearTimeout(timer);socket.current?.close();pc.current?.close();stream.current?.getTracks().forEach(t=>t.stop())};
 },[identity]);
 useEffect(()=>{bottom.current?.scrollIntoView({behavior:'smooth'})},[messages,selected]);
 useEffect(()=>{const timer=setInterval(()=>setTyping(t=>Object.fromEntries(Object.entries(t).filter(([,v])=>Date.now()-v<3000))),1000);return()=>clearInterval(timer)},[]);
 useEffect(()=>{if(callPeer.current&&users.length&&!users.some(u=>u.id===callPeer.current)){cleanup();notify('This account is no longer available.')}},[users]);
 const me=users.find(u=>u.id===identity),active=chats.find(c=>c.id===selected),other=(c:Chat)=>users.find(u=>c.members.includes(u.id)&&u.id!==identity),title=(c:Chat)=>c.group?c.name:other(c)?.name || 'Conversation';
 const currentMessages=messages.filter(m=>m.chatId===selected),filtered=chats.filter(c=>title(c).toLowerCase().includes(search.toLowerCase()));
 async function startCall(video:boolean){const peer=active&&!active.group?other(active):null;if(!peer)return notify('Open a direct conversation to start a call.');if(!online.includes(peer.id))return notify(`${peer.name} is offline. Try again when they’re online.`);setCall({peer:peer.id,video,status:'Calling…'});try{const connection=await setup(peer.id,video);const offer=await connection.createOffer();await connection.setLocalDescription(offer);send({type:'offer',to:peer.id,data:offer,video})}catch{notify('Microphone or camera access is unavailable. Allow access and try again.');cleanup()}}
 async function accept(){if(!incoming?.from)return;const offer=incoming;setIncoming(null);setCall({peer:offer.from!,video:!!offer.video,status:'Connecting…'});try{const connection=await setup(offer.from!,!!offer.video);await connection.setRemoteDescription(offer.data);for(const ice of pendingIce.current)await connection.addIceCandidate(ice);pendingIce.current=[];const answer=await connection.createAnswer();await connection.setLocalDescription(answer);send({type:'answer',to:offer.from,data:answer})}catch{send({type:'decline',to:offer.from});notify('Please allow microphone and camera access.');cleanup()}}
 const submit=()=>{if(draft.trim()&&active&&send({type:'message',chatId:active.id,text:draft})){setDraft('');setEmoji(false)}};
 return <div className="app-shell">
  <nav className="rail"><a className="brand" href="/" aria-label="Skype home">S</a><div className="rail-links">{[['chat','Chats'],['phone','Calls'],['users','Contacts']].map(([icon,label])=><button key={label} className={tab===label?'rail-item active':'rail-item'} onClick={()=>setTab(label!)}><Icon name={icon!}/><span>{label}</span></button>)}</div><div className="rail-bottom"><button className="rail-item" onClick={()=>setModal('settings')} aria-label="Settings"><Icon name="settings"/></button><button className="profile-button" onClick={()=>setModal('profile')} aria-label="Account settings"><Avatar user={me} small online={connected}/></button></div></nav>
  <aside className="sidebar"><div className="workspace"><span>Personal workspace</span><Icon name="down" size={15}/></div><div className="sidebar-title"><h1>{tab}</h1><button className="icon-button" title="New conversation" onClick={()=>{setMembers([]);setModal('new')}}><Icon name="edit"/></button></div><label className="search"><Icon name="search" size={17}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search people or chats"/><kbd>⌘ K</kbd></label>
   {tab==='Chats'&&<><div className="chat-tabs"><button className="selected">All chats <span>{chats.length}</span></button><button onClick={()=>notify('Your conversations are up to date. No unread messages.')}>Unread</button></div><div className="list-label">RECENT CONVERSATIONS <button className="icon-button" onClick={()=>{setMembers([]);setModal('new')}} aria-label="Create chat"><Icon name="plus" size={16}/></button></div><div className="conversation-list">{filtered.map(c=>{const last=messages.filter(m=>m.chatId===c.id).at(-1);return <button className={`conversation ${selected===c.id?'selected':''}`} key={c.id} onClick={()=>{setSelected(c.id);setDetails(false)}}><Avatar user={other(c)} group={c.group} online={!c.group&&online.includes(other(c)?.id || '')}/><span className="conversation-copy"><span className="conversation-name">{title(c)}<time>{last?new Date(last.createdAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):''}</time></span><span className="preview">{last?.senderId===identity?'You: ':''}{last?.text || 'Start a conversation'}</span></span></button>})}{!filtered.length&&<p className="empty-small">No conversations found.</p>}</div></>}
   {tab==='Contacts'&&<div className="contact-list"><div className="list-label">YOUR PEOPLE · {Math.max(0,users.length-1)}</div>{users.filter(u=>u.id!==identity&&u.name.toLowerCase().includes(search.toLowerCase())).map(u=><button key={u.id} className="conversation" onClick={()=>{send({type:'create-chat',members:[u.id]});setTab('Chats')}}><Avatar user={u} online={online.includes(u.id)}/><span className="conversation-copy"><strong>{u.name}</strong><span className="preview">{u.role}</span></span><Icon name="chat" size={17}/></button>)}</div>}
   {tab==='Calls'&&<div className="empty-calls"><span className="empty-icon"><Icon name="phone" size={28}/></span><h3>A familiar voice, a little closer</h3><p>Choose a contact to start an audio or video call.</p><button className="primary" onClick={()=>setTab('Contacts')}>Find a contact</button></div>}
   <div className="sidebar-footer"><span className={`connection-dot ${connected?'on':''}`}/><span>{connected?'All caught up':'Reconnecting…'}</span><span className="shortcut">Made for connection</span></div>
  </aside>
  <main className="main">{active?<><header className="chat-header"><Avatar user={other(active)} group={active.group} online={!active.group&&online.includes(other(active)?.id || '')}/><div className="header-copy"><h2>{title(active)}{active.group&&<span className="group-tag">Group</span>}</h2><p>{active.group?`${active.members.length} members · ${active.members.filter(id=>online.includes(id)).length} online`:online.includes(other(active)?.id || '')?'Active now':'Offline'}</p></div><div className="header-actions"><button className="icon-button" title="Audio call" onClick={()=>startCall(false)}><Icon name="phone"/></button><button className="icon-button" title="Video call" onClick={()=>startCall(true)}><Icon name="video"/></button><span className="divider"/><button className={`icon-button ${details?'blue':''}`} title="Conversation details" onClick={()=>setDetails(!details)}><Icon name="info"/></button></div></header>
  <div className="chat-body"><section className="chat-content"><div className="conversation-intro"><span className="intro-icon"><Icon name={active.group?'users':'chat'} size={27}/></span><h2>{active.group?'Good conversations start here.':`Say hello to ${other(active)?.name.split(' ')[0]}.`}</h2><p>{active.group?'A little space for big ideas, small updates, and everything in between.':'Distance is just a detail. Make time for a little connection.'}</p><span className="intro-line"/></div><div className="date-label"><span/>{new Date().toLocaleDateString([],{weekday:'long',month:'long',day:'numeric'})}<span/></div>
   <div className="messages">{currentMessages.map((m,i)=>{const user=users.find(u=>u.id===m.senderId),own=m.senderId===identity,continued=currentMessages[i-1]?.senderId===m.senderId;return <div className={`message-row ${own?'own':''} ${continued?'continued':''}`} key={m.id}>{!own&&<span className="message-avatar">{!continued&&<Avatar user={user} small/>}</span>}<div className="message-content">{!continued&&<div className="message-meta"><strong>{own?'You':user?.name || 'Deleted account'}</strong><time>{new Date(m.createdAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</time></div>}<div className="bubble">{m.text}</div>{own&&i===currentMessages.length-1&&<span className="delivered"><Icon name="check" size={12}/> Sent</span>}</div></div>})}<div ref={bottom}/></div>
  </section>{details&&<aside className="details"><div className="detail-heading"><h3>Conversation details</h3><button className="icon-button" onClick={()=>setDetails(false)} aria-label="Close details"><Icon name="close" size={17}/></button></div><Avatar user={other(active)} group={active.group}/><h3>{title(active)}</h3><p>{active.members.length} members</p><div className="list-label">MEMBERS</div>{active.members.map(id=>{const u=users.find(x=>x.id===id);return <div className="detail-member" key={id}><Avatar user={u} small online={online.includes(id)}/><span>{u?.name}{id===identity?' (you)':''}</span></div>})}</aside>}</div>
  <div className="composer-wrap"><div className="typing">{typing[selected]?'Someone is typing…':''}</div><form className="composer" onSubmit={e=>{e.preventDefault();submit()}}><textarea aria-label="Message" value={draft} maxLength={4000} rows={1} placeholder={`Message ${title(active)}…`} onChange={e=>{setDraft(e.target.value);if(Date.now()-lastTyping.current>1500){send({type:'typing',chatId:selected});lastTyping.current=Date.now()}}} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();submit()}}}/><div className="composer-actions"><button type="button" className="icon-button" title="Add emoji" onClick={()=>setEmoji(!emoji)}><Icon name="smile"/></button><span className="composer-hint">Shift + Enter for a new line</span><button type="submit" className="send-button" disabled={!draft.trim()||!connected} aria-label="Send message"><Icon name="send" size={18}/></button></div>{emoji&&<div className="emoji-picker">{['👋','😊','❤️','🎉','👍','✨','☕','🚀','🌿','😂','🙌','💙'].map(x=><button key={x} type="button" onClick={()=>setDraft(d=>d+x)}>{x}</button>)}</div>}</form><div className="composer-footer"><Icon name="chat" size={12}/><span>A little closer, wherever you are.</span><span className="skype-word">skype</span></div></div></>:<div className="welcome"><Icon name="chat" size={40}/><h2>Welcome to Skype</h2><p>{users.length<2?'Invite someone to register, then start your first conversation.':'Choose a contact and start a conversation.'}</p><button className="primary" onClick={()=>setTab('Contacts')}>View contacts</button></div>}</main>
  {notice&&<div role="status" className="toast"><Icon name="info" size={18}/>{notice}<button className="icon-button" onClick={()=>setNotice('')} aria-label="Dismiss"><Icon name="close" size={15}/></button></div>}
  {modal&&<div className="modal-backdrop" onClick={()=>setModal('')}><section className="modal" role="dialog" aria-modal="true" aria-label={modal==='new'?'New conversation':'Profile settings'} onClick={e=>e.stopPropagation()}><button className="modal-close icon-button" onClick={()=>setModal('')} aria-label="Close"><Icon name="close"/></button><span className="modal-icon"><Icon name={modal==='new'?'chat':'users'} size={26}/></span>{modal==='new'?<><h2>Bring your people together</h2><p>A quick hello or the next big idea. Who’s joining?</p><input className="text-input" value={groupName} onChange={e=>setGroupName(e.target.value)} placeholder="Group name (optional)"/>{users.filter(u=>u.id!==identity).map(u=><label className="person-option" key={u.id}><Avatar user={u} small/><span>{u.name}</span><input type="checkbox" checked={members.includes(u.id)} onChange={()=>setMembers(m=>m.includes(u.id)?m.filter(x=>x!==u.id):[...m,u.id])}/></label>)}{users.length<2&&<p>No other members yet. Invite someone to register to start a conversation.</p>}<button className="primary full" disabled={!members.length||!connected} onClick={()=>{send({type:'create-chat',members,name:groupName||'New group'});setModal('');setGroupName('');setTab('Chats')}}>Start conversation <Icon name="chevron" size={17}/></button></>:<Account user={currentUser} onSignedOut={onSignedOut}/>}</section></div>}
  {(call||incoming)&&<div className="modal-backdrop call-backdrop"><section className="call-modal"><span className="call-brand">skype</span><Avatar user={users.find(u=>u.id===(call?.peer||incoming?.from))}/><h2>{users.find(u=>u.id===(call?.peer||incoming?.from))?.name}</h2><p>{incoming?`Incoming ${incoming.video?'video':'audio'} call…`:call?.status}</p><video ref={remoteVideo} autoPlay playsInline className={call?.video?'remote-video':'audio-only'}/><video ref={localVideo} autoPlay playsInline muted className={call?.video?'local-video':'audio-only'}/><div className="call-controls">{incoming?<><button className="call-control accept" onClick={accept} aria-label="Accept call"><Icon name="phone"/></button><button className="call-control hangup" onClick={()=>{send({type:'decline',to:incoming.from});cleanup()}} aria-label="Decline call"><Icon name="close"/></button></>:<><button className={`call-control ${muted?'off':''}`} onClick={()=>{stream.current?.getAudioTracks().forEach(t=>t.enabled=muted);setMuted(!muted)}} aria-label={muted?'Unmute':'Mute'}><Icon name="mic"/></button>{call?.video&&<button className={`call-control ${!camera?'off':''}`} onClick={()=>{stream.current?.getVideoTracks().forEach(t=>t.enabled=!camera);setCamera(!camera)}} aria-label="Toggle camera"><Icon name="video"/></button>}<button className="call-control hangup" onClick={()=>{send({type:'hangup',to:callPeer.current});cleanup()}} aria-label="End call"><Icon name="phone"/></button></>}</div><small>Microphone and camera require localhost or HTTPS.</small></section></div>}
 </div>
}
export default App;
