const element = (tag, text, className) => { const el=document.createElement(tag); if(text!=null)el.textContent=text; if(className)el.className=className; return el; };

export async function refreshActivity(game) {
    const version=game._activityRequest=(game._activityRequest||0)+1;
    try {
        const result=await SFApi.State.activity(game.gameId,1);
        if(version!==game._activityRequest)return;
        const button=document.getElementById('turnCounter'); if(!button)return;
        button.classList.toggle('has-activity',result.unreadCount>0);
        button.dataset.severity=result.severity;
        button.setAttribute('aria-label',`Turn ${game.gameState?.currentTurn?.turn_number||1}. ${result.unreadCount} unread activity items. Open activity.`);
        button.title=result.unreadCount ? `${result.unreadCount} unread activity items` : 'Open turn activity';
    } catch {
        const button=document.getElementById('turnCounter');
        if(button)button.title='Activity could not refresh. Open to retry.';
    }
}

export function openActivity(game) {
    const existing=document.getElementById('turnActivityDialog'); if(existing?.open)return;
    const dialog=element('dialog',null,'activity-dialog'); dialog.id='turnActivityDialog';
    dialog.setAttribute('aria-labelledby','activityTitle');
    const header=element('header'); const title=element('h2','Turn activity'); title.id='activityTitle';
    const close=element('button','Close','sf-btn sf-btn-secondary'); close.type='button'; close.onclick=()=>dialog.close(); header.append(title,close);
    const intro=element('p','Since your last review. Reports begin with turns resolved after this update.','activity-intro');
    const modes=element('div',null,'activity-actions');
    const unread=element('button','Unread','sf-btn sf-btn-secondary'),history=element('button','History','sf-btn sf-btn-secondary');
    unread.type=history.type='button'; modes.append(unread,history);
    const list=element('div',null,'activity-list'); list.setAttribute('aria-busy','false');
    const status=element('p','','activity-status'); status.setAttribute('role','status');
    const footer=element('footer',null,'activity-actions');
    const more=element('button','Load more','sf-btn sf-btn-secondary'),mark=element('button','Mark shown as read','sf-btn sf-btn-primary'); more.type=mark.type='button'; footer.append(more,mark);
    dialog.append(header,intro,modes,list,status,footer); document.body.append(dialog);
    let mode='unread',cursor=null,boundary=null,page=0,request=0;
    const trigger=document.activeElement;
    document.getElementById('turnCounter')?.setAttribute('aria-expanded','true');
    dialog.addEventListener('close',()=>{request++;dialog.remove();document.getElementById('turnCounter')?.setAttribute('aria-expanded','false');trigger?.focus();});
    async function load(reset=false) {
        const version=++request;
        if(reset){cursor=mode==='history'?0:null;boundary=null;page=0;list.replaceChildren();}
        unread.setAttribute('aria-pressed',String(mode==='unread'));history.setAttribute('aria-pressed',String(mode==='history'));
        list.setAttribute('aria-busy','true'); more.disabled=mark.disabled=true; status.textContent='Loading activity…';
        try {
            const data=await SFApi.State.activity(game.gameId,25,cursor,boundary);
            if(version!==request||!dialog.open)return;
            boundary=data.snapshotBoundary;cursor=data.pageBoundary;page=cursor;
            for(const event of data.events){
                let section=list.lastElementChild;
                if(!section||section.dataset.turn!==String(event.turnNumber)){
                    section=element('section');section.dataset.turn=String(event.turnNumber);section.append(element('h3',`Turn ${event.turnNumber}`));list.append(section);
                }
                const row=element('div',null,'activity-event');row.dataset.severity=event.severity;
                if(event.severity==='danger'||event.severity==='warning')row.append(element('strong',event.severity==='danger'?'Critical':'Attention','activity-tone'));
                row.append(element('span',event.summary));
                const unit=game.objects.find(o=>Number(o.id)===Number(event.objectId)&&Number(o.owner_id)===Number(game.userId));
                if(unit){const locate=element('button','Focus unit','sf-btn sf-btn-secondary');locate.type='button';locate.onclick=()=>{game.selectUnit(unit.id);game.camera.x=unit.x;game.camera.y=unit.y;game.render();dialog.close();};row.append(locate);}
                section.append(row);
            }
            more.hidden=!data.hasMore;more.disabled=false;mark.hidden=mode==='history'||!list.childElementCount;mark.disabled=false;
            status.textContent=list.childElementCount ? (data.hasMore?'More activity is available.':'You have reached the end of this snapshot.') : (mode==='history'?'No recorded activity yet.':'You are caught up.');
            more.textContent='Load more';
        } catch {if(version!==request)return;status.textContent='Could not load activity. Try again.';more.hidden=false;more.disabled=false;more.textContent='Retry';mark.disabled=true;}
        finally {if(version===request)list.setAttribute('aria-busy','false');}
    }
    more.onclick=()=>load();unread.onclick=()=>{mode='unread';load(true);};history.onclick=()=>{mode='history';load(true);};
    mark.onclick=async()=>{
        const shown=page;mark.disabled=true;
        try {await SFApi.State.ackActivity(game.gameId,shown);status.textContent='Shown activity marked as read. Newer activity remains unread.';await refreshActivity(game);}
        catch {status.textContent='Could not save your read position. Try again.';mark.disabled=false;}
    };
    dialog.showModal();close.focus();load(true);
}
