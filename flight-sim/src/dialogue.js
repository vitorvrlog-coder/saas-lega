/* dialogue.js — conversas, comércio, missões, recrutamento e relações (lógica, sem DOM).
 * Cada nó: { text, options: [{ label, act, arg }] }. A interface (foot.js) só exibe e devolve a escolha. */
(function (root) {
  'use strict';
  const FS = (root.FS = root.FS || {});
  const M = FS.M;
  const IT = FS.Items;

  const first = (n) => n.name.replace(/^Dra\. /, '').split(' ')[0];
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  function trustWord(t) {
    if (t >= 70) return 'confio em você de verdade';
    if (t >= 40) return 'você tem sido alguém de palavra';
    if (t >= 10) return 'ainda estou te conhecendo';
    if (t > -20) return 'não sei se posso confiar em você';
    return 'fique longe de mim';
  }
  // multiplicador de preço: confiança e reputação barateiam
  function markup(sim, n) {
    const rep = n.faction ? sim.factions[n.faction].rep : 0;
    return M.clamp(1.55 - n.trust / 180 - rep / 220, 0.9, 1.9);
  }

  const Dialogue = {
    markup,
    first,

    greet(sim, n, player) {
      n.met = true;
      const f = n.faction && sim.factions[n.faction];
      if (n.state === 'trapped') return this.node(sim, n, player, n.name.split(' ')[0] + ': "Você veio me tirar daqui? Por favor!"');
      if (f && f.hostile && f.rep < 20 && !n.companion) {
        return { text: first(n) + ': "' + pick(['Território dos Corvos. Você tem dez segundos pra explicar o que quer.', 'Mãos onde eu possa ver. O que você quer aqui?']) + '"',
          options: [
            { label: 'Quero pagar passagem (itens no valor de 30).', act: 'toll' },
            n.questDef && n.questDef.defect ? { label: '(Em voz baixa) Você parece cansada disso tudo.', act: 'quest' } : null,
            { label: 'Já estou indo embora.', act: 'bye' },
          ].filter(Boolean) };
      }
      let hello;
      if (n.trust >= 50) hello = pick(['Que bom te ver de novo!', 'Ei! Senti sua falta por aqui.', 'Chegou na hora certa.']);
      else if (n.trust >= 10) hello = pick(['Olá de novo.', 'E aí, tudo certo?', 'Oi. Precisa de algo?']);
      else if (n.trust > -20) hello = pick(['Quem é você? Fique onde está.', 'Não chegue mais perto com essa arma.', 'Olá, forasteiro. Fale devagar.']);
      else hello = 'Você de novo? Não tenho nada para você.';
      if (n.grief) { hello = 'Desculpe... ainda estou abalado com o que aconteceu.'; n.grief = 0; }
      return this.node(sim, n, player, first(n) + ': "' + hello + '"');
    },

    node(sim, n, player, text) {
      const opts = [];
      const inv = player.inv;
      if (n.state === 'trapped') {
        opts.push({ label: 'Vem comigo. Vou te levar em segurança.', act: 'rescue' });
        opts.push({ label: 'Quem é você?', act: 'who' });
        return { text, options: opts };
      }
      opts.push({ label: 'Quem é você?', act: 'who' });
      opts.push({ label: 'Como estão as coisas?', act: 'status' });
      if (n.trust > -30) opts.push({ label: 'Vamos negociar.', act: 'trade' });
      // missões
      const q = sim.quests.find((x) => x.giver === n.id && (x.status === 'offered' || x.status === 'active')) || (n.extraQuest && n.extraQuest.status !== 'done' ? n.extraQuest : null);
      if (q && q.status === 'active') opts.push(sim.questReady(q, inv) ? { label: 'Fiz o que você pediu: ' + q.title + '.', act: 'questDone', arg: q } : { label: 'Sobre "' + q.title + '"...', act: 'questInfo', arg: q });
      else if ((n.questDef && !sim.quests.some((x) => x.giver === n.id && x.status === 'done')) || (q && q.status === 'offered')) opts.push({ label: 'Precisa de ajuda com alguma coisa?', act: 'quest' });
      if (n.skills.med > 0.5 && player.hp < 85) opts.push({ label: 'Pode tratar meus ferimentos?', act: 'treat' });
      if (n.companion) opts.push({ label: 'Ordens para ' + first(n) + '...', act: 'orders' });
      else if (n.role !== 'lider' && !n.trader) opts.push({ label: 'Junte-se a mim.', act: 'recruit' });
      opts.push({ label: 'Tenho um presente para você.', act: 'gift' });
      opts.push({ label: 'Vamos conversar um pouco.', act: 'social' });
      if (n.affinity >= 70 && n.trust >= 50 && !n.partner && !player.partner && n.age >= 18) opts.push({ label: 'Sinto algo especial por você. Quer ficar comigo?', act: 'romance' });
      if (n.partner === 'player') opts.push({ label: 'Passar um tempo juntos.', act: 'together' });
      if (n.role === 'lider' && n.faction) opts.push({ label: 'Quero ser aliado da ' + sim.factions[n.faction].name + '.', act: 'ally' });
      opts.push({ label: 'Até mais.', act: 'bye' });
      return { text, options: opts };
    },

    choose(sim, n, player, act, arg) {
      const inv = player.inv;
      const say = (t) => first(n) + ': "' + t + '"';
      const back = (t) => this.node(sim, n, player, t);
      switch (act) {
        case 'who': {
          const f = n.faction ? sim.factions[n.faction].name : (n.formerFaction ? 'ex-' + sim.factions[n.formerFaction].name : 'sem grupo');
          return back(say('Sou ' + n.name + ', ' + n.age + ' anos. ' + n.bio) + '\n[' + n.specName + ' · ' + f + ']');
        }
        case 'status': {
          const parts = [];
          if (n.food < 35) parts.push('Estou com fome, para ser sincero.');
          if (n.water < 35) parts.push('A água anda acabando.');
          if (n.faction) {
            const f = sim.factions[n.faction];
            parts.push(f.morale < 35 ? 'O pessoal está desanimado, a comida está curta.' : f.res.fuel <= 0 && n.faction === 'colina' ? 'O gerador parou. Sem combustível não temos luz à noite.' : 'Estamos nos virando.');
          }
          const partner = n.partner && n.partner !== 'player' && sim.npcs[n.partner];
          if (partner) parts.push(first(partner) + ' e eu estamos juntos. É o que me mantém de pé.');
          if (n.partner === 'player') parts.push('Com você por perto fica mais fácil.');
          const rival = Object.keys(n.rel).find((k) => n.rel[k] < -40 && sim.npcs[k] && sim.npcs[k].alive);
          if (rival) parts.push('E fique de olho em ' + sim.npcs[rival].name + '. Não suporto essa pessoa.');
          if (n.memory.length) parts.push('Lembro bem: ' + n.memory[0].text.toLowerCase());
          parts.push('Sobre você... ' + trustWord(n.trust) + '.');
          return back(say(parts.join(' ')));
        }
        case 'trade': return { trade: true };
        case 'quest': {
          let q = n.extraQuest && n.extraQuest.status === 'offered' ? n.extraQuest : sim.offerQuest(n);
          if (!q) return back(say('Por enquanto não preciso de nada, obrigado.'));
          if (q.status === 'active') return back(say('Você já está cuidando disso.'));
          if (q.status === 'done') return back(say('Você já me ajudou muito.'));
          if (q.defect && n.trust < -10 && n.faction) n.trust = -10;
          return { text: say(q.desc), options: [{ label: 'Pode deixar comigo.', act: 'accept', arg: q }, { label: 'Agora não posso.', act: 'back' }] };
        }
        case 'accept': sim.acceptQuest(arg); sim.adjustTrust(n, 3); return back(say('Obrigado. Vou ficar esperando.'));
        case 'questInfo': return back(say(arg.desc + (arg.type === 'clear' ? ' (' + Math.max(0, (sim.killsByBuilding[arg.bid] || 0) - arg.baseKills) + '/' + arg.kills + ')' : '')));
        case 'questDone': {
          sim.completeQuest(arg, inv);
          let t = 'Você cumpriu sua palavra. Não vou esquecer.';
          if (arg.defect) t = 'Obrigada. Se você me chamar, eu vou com você. Chega de Corvos.';
          if (arg.item === 'antibiotico' && n.id === 'carlos') t = 'Já sinto a febre baixando. Te devo a vida.';
          const rw = Object.keys(arg.reward || {}).map((id) => arg.reward[id] + '× ' + IT.ITEMS[id].name).join(', ');
          return back(say(t) + (rw ? '\n[Recompensa: ' + rw + ']' : ''));
        }
        case 'treat': {
          const free = sim.quests.some((q) => q.giver === n.id && q.status === 'done') || (n.faction && sim.factions[n.faction].rep >= 40) || n.companion;
          if (!free && !inv.has('bandagem') && !inv.has('kit_medico')) return back(say('Posso tratar, mas preciso de material: traga uma bandagem ou um kit médico.'));
          if (!free) inv.remove(inv.has('kit_medico') ? 'kit_medico' : 'bandagem', 1);
          player.hp = Math.min(100, player.hp + 60); player.bleeding = 0; if (player.infection > 0 && player.infection < 40) player.infection = 0;
          return back(say(free ? 'Fica quieto... pronto. Esse é por conta da casa.' : 'Pronto. Usei seu material, mas você vai ficar bem.'));
        }
        case 'recruit': {
          const comps = sim.companions().length;
          if (comps >= 3) return back(say('Seu grupo já está grande demais. Mais gente chama atenção.'));
          if (n.state === 'trapped') return back(say('Primeiro me tira daqui!'));
          if (n.wantsToDefect) { sim.recruit(n); return back(say('Vamos embora antes que o Diego perceba.')); }
          if (n.faction && sim.factions[n.faction].hostile) return back(say('Tá maluco? O Diego me mataria.'));
          if (n.hurt) return back(say('Com essa perna eu não ando nem dez metros...'));
          const need = n.faction ? 55 : 30;
          if (n.trust < need) return back(say(n.trust < 0 ? 'Seguir você? Nem pensar.' : 'Eu mal te conheço. Me mostre que posso confiar em você.') + '\n[Confiança ' + Math.round(n.trust) + ' / ' + need + ']');
          if (n.partner && n.partner !== 'player' && sim.npcs[n.partner] && sim.npcs[n.partner].alive && !sim.npcs[n.partner].companion) return back(say('Não vou deixar ' + first(sim.npcs[n.partner]) + ' para trás.'));
          sim.recruit(n);
          return back(say(pick(['Tudo bem. Eu vou com você.', 'Certo. Mas não me faça me arrepender.', 'Vamos nessa. Junto a gente vai mais longe.'])));
        }
        case 'rescue': {
          n.state = 'idle'; n.rescued = true; n.companion = true; n.order = 'follow'; n.missing = false;
          sim.adjustTrust(n, 25, 'Você me resgatou.');
          sim.addLog('Você encontrou ' + n.name + '.', 'quest');
          return { text: say('Obrigada! Vou atrás de você. Me leve até os meus.'), options: [{ label: 'Fique perto de mim.', act: 'bye' }] };
        }
        case 'gift': {
          const giftable = inv.items.filter((e) => ['comida', 'agua', 'remedio', 'municao'].includes(IT.ITEMS[e.id].cat) || e.id === 'sementes');
          if (!giftable.length) return back(say('É gentileza sua, mas você não tem nada para dar.'));
          return { text: 'O que você quer dar para ' + first(n) + '?', options: giftable.slice(0, 7).map((e) => ({ label: IT.ITEMS[e.id].name + (e.qty > 1 ? ' (' + e.qty + ')' : ''), act: 'giveItem', arg: e.id })).concat([{ label: 'Deixa pra lá.', act: 'back' }]) };
        }
        case 'giveItem': {
          const def = IT.ITEMS[arg];
          const qty = def.stack ? Math.min(inv.count(arg), 10) : 1;
          inv.remove(arg, qty); n.inv.add(arg, qty);
          const v = def.value * qty;
          if (def.food) n.food = Math.min(100, n.food + def.food);
          if (def.water) n.water = Math.min(100, n.water + def.water);
          const gain = Math.min(15, Math.max(2, v / (3 + n.traits.gen * 3)) * (n.food < 35 || n.water < 35 ? 2 : 1));
          sim.adjustTrust(n, gain, 'Você me deu ' + def.name.toLowerCase() + '.');
          n.affinity = Math.min(100, n.affinity + gain / 2);
          return back(say(gain > 8 ? 'Nossa, isso ajuda muito. Obrigado de verdade.' : 'Obrigado, de coração.'));
        }
        case 'social': {
          const now = sim.t;
          if (n.lastSocial && now - n.lastSocial < 1) return back(say('Adoro conversar, mas agora preciso voltar ao trabalho.'));
          n.lastSocial = now;
          const gain = 3 + n.traits.social * 6;
          n.affinity = Math.min(100, n.affinity + gain);
          sim.adjustTrust(n, 2);
          const topics = [
            'Antes de tudo isso eu ' + ({ medica: 'operava doze horas por dia', mecanica: 'trabalhava nos hangares do aeroporto', comerciante: 'tinha o posto mais movimentado da região', exploradora: 'corria pelos telhados nos fins de semana', engenheiro: 'construía pontes', lider: 'dava aula para crianças' }[n.spec] || 'tinha uma vida normal') + '. Parece outra vida.',
            'Às vezes eu subo no telhado só pra ver o pôr do sol. Ainda é bonito.',
            'Do que você mais sente falta? Eu sinto falta de café quente.',
            'Você já pensou em ir embora daqui? Dizem que o aeroporto ainda tem um caça inteiro.',
            'Obrigado por perguntar como eu estou. Ninguém mais pergunta.',
          ];
          return back(say(pick(topics)) + '\n[Afinidade ' + Math.round(n.affinity) + ']');
        }
        case 'romance': {
          const chance = 0.45 + n.traits.social * 0.3 + (n.affinity - 70) / 60;
          if (Math.random() < chance) {
            n.partner = 'player'; player.partner = n.id;
            sim.adjustTrust(n, 15, 'Decidimos ficar juntos.');
            sim.addLog('Você e ' + n.name + ' agora estão juntos.', 'social');
            return back(say('Eu também sinto isso. Vamos cuidar um do outro.'));
          }
          n.affinity -= 10;
          return back(say('Você é importante para mim, mas prefiro que sejamos amigos. Tudo bem?'));
        }
        case 'together': {
          n.affinity = Math.min(100, n.affinity + 3); player.morale = Math.min(100, (player.morale || 50) + 15);
          return back(say(pick(['Fico feliz que você esteja aqui.', 'Vamos sobreviver a isso, juntos.', 'Lembra quando a gente se conheceu? Parece que foi há anos.'])));
        }
        case 'ally': {
          const f = sim.factions[n.faction];
          if (f.rep >= 40) return back(say('Você já é nosso aliado. Os nossos portões estão abertos e os preços, melhores.'));
          return back(say('Aliança se conquista. Ajude a ' + f.name + ' com o que precisamos e conversamos.') + '\n[Reputação ' + Math.round(f.rep) + ' / 40]');
        }
        case 'toll': {
          const f = sim.factions[n.faction];
          const offer = inv.items.filter((e) => IT.ITEMS[e.id].cat !== 'arma' && IT.ITEMS[e.id].cat !== 'nota').sort((a, b) => IT.ITEMS[b.id].value - IT.ITEMS[a.id].value);
          let paid = 0;
          for (const e of offer.slice()) { if (paid >= 30) break; const take = Math.min(e.qty, Math.ceil((30 - paid) / IT.ITEMS[e.id].value)); paid += take * IT.ITEMS[e.id].value; inv.remove(e.id, take); n.inv.add(e.id, take); }
          if (paid < 30) return { text: say('Isso é tudo? Some daqui antes que eu mude de ideia.'), options: [{ label: 'Já vou.', act: 'bye' }] };
          f.rep = Math.max(f.rep, 20); sim.trespassT = 0;
          sim.addLog('Você pagou passagem aos Corvos.', 'faction');
          return back(say('Muito bem. Pode circular. Por enquanto.'));
        }
        case 'orders':
          return { text: 'O que ' + first(n) + ' deve fazer?', options: [
            { label: 'Me siga.', act: 'order', arg: 'follow' }, { label: 'Espere aqui.', act: 'order', arg: 'wait' },
            { label: 'Defenda esta área.', act: 'order', arg: 'defend' }, { label: 'Vá para a base.', act: 'order', arg: 'base' },
            { label: 'Vamos trocar equipamentos.', act: 'exchange' }, { label: 'Você está dispensado(a) do grupo.', act: 'dismiss' }, { label: 'Voltar.', act: 'back' }] };
        case 'order': {
          if (arg === 'base' && !sim.base.claimed) return back(say('Que base? Ainda não temos um lugar.'));
          n.order = arg; n.orderPos = { x: player.x, y: player.y, z: player.z };
          if (arg === 'base' && !sim.base.residents.includes(n.id)) sim.base.residents.push(n.id);
          return back(say({ follow: 'Estou logo atrás de você.', wait: 'Vou esperar aqui.', defend: 'Ninguém passa por aqui.', base: 'Vou para a base e ajudo por lá.' }[arg]));
        }
        case 'exchange': return { exchange: true };
        case 'dismiss': sim.leaveCompanion(n, null); sim.adjustTrust(n, -5); return { text: say('Tudo bem. Cuide-se lá fora.'), options: [{ label: 'Tchau.', act: 'bye' }] };
        case 'back': return this.node(sim, n, player, first(n) + ': "Mais alguma coisa?"');
        default: return null;
      }
    },

    /* ---------------------------------------------------------- comércio */
    tradeQuote(sim, n, give, take) {
      const mk = markup(sim, n);
      const gv = give.reduce((s, e) => s + IT.ITEMS[e.id].value * e.qty, 0) / mk;
      const tv = take.reduce((s, e) => s + IT.ITEMS[e.id].value * e.qty, 0) * mk;
      return { give: gv, take: tv, ok: gv + 0.01 >= tv && (gv > 0 || tv > 0), markup: mk };
    },
    executeTrade(sim, n, player, give, take) {
      const q = this.tradeQuote(sim, n, give, take);
      if (!q.ok) return false;
      give.forEach((e) => { player.inv.remove(e.id, e.qty); n.inv.add(e.id, e.qty); });
      take.forEach((e) => { n.inv.remove(e.id, e.qty); player.inv.add(e.id, e.qty); });
      // comerciantes repõem estoque básico
      if (n.trader) ['agua', 'enlatado', 'bandagem', 'mun_9mm'].forEach((id) => { if (n.inv.count(id) < 3) n.inv.add(id, 4); });
      sim.adjustTrust(n, Math.min(4, 1 + q.give / 40));
      if (n.faction) sim.changeRep(n.faction, 1);
      return true;
    },
  };

  FS.Dialogue = Dialogue;
})(typeof window !== 'undefined' ? window : globalThis);
