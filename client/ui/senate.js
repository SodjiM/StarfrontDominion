// Senate modal UI module (ESM)

export function showSenate() {
        const content = document.createElement('div');
        content.innerHTML = `
            <div style="display:grid; gap:12px;">
                <p>Government management is coming soon.</p>
                <ul style="margin-left:16px; color:#ccc; line-height:1.6;">
                    <li>Propose and vote on laws</li>
                    <li>Manage senators and political factions</li>
                    <li>Diplomacy and interstellar policies</li>
                </ul>
            </div>`;
        UI.showModal({ title:'🏛️ Senate', content, actions:[{ text:'Close', style:'secondary', action:()=>true }] });
}


