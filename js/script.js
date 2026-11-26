/* SplitPay — divisão igual, proporcional ou por itens, com acerto de contas entre amigos */

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const escapar = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const banco = {
  ler(k, padrao) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? padrao; } catch { return padrao; } },
  salvar(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem storage */ } }
};
const brl = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
/* Trabalha em centavos para não perder dinheiro com arredondamento */
function centavos(t) {
  let s = String(t ?? '').replace(/[R$\s]/g, '');
  if (!s) return 0;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
}
const fmt = (c) => (c ? (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');
const CORES = ['#0b8f5a', '#e8590c', '#7048e8', '#1c7ed6', '#d6336c', '#f59f00', '#0ca678', '#495057', '#ae3ec9', '#2f9e44'];
const iniciais = (n) => n.trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
const avatar = (p) => `<span class="avatar" style="--c:${p.cor}" aria-hidden="true">${escapar(iniciais(p.nome))}</span>`;

function contaExemplo() {
  return {
    id: null, nome: 'Pizza de sexta', modo: 'itens', total: 0, servico: true, extra: 0, desconto: 0, tipoPeso: 'pct',
    pessoas: [{ id: 1, nome: 'Ana', cor: CORES[0], peso: 25 }, { id: 2, nome: 'Bruno', cor: CORES[1], peso: 25 }, { id: 3, nome: 'Carla', cor: CORES[2], peso: 25 }, { id: 4, nome: 'Diego', cor: CORES[3], peso: 25 }],
    itens: [
      { id: 1, desc: 'Pizza grande calabresa', valor: 8990, quem: [] },
      { id: 2, desc: 'Pizza média marguerita', valor: 6490, quem: [1, 3] },
      { id: 3, desc: 'Refrigerante 2 L', valor: 1490, quem: [2, 4] },
      { id: 4, desc: 'Cerveja (4 long necks)', valor: 4400, quem: [2, 4] },
      { id: 5, desc: 'Sobremesa', valor: 2890, quem: [3] }
    ],
    pagou: 'um', pagador: 2, pagamentos: {}
  };
}
let conta = banco.ler('sp_atual', null) ?? contaExemplo();
let historico = banco.ler('sp_hist', []);
const salvar = () => banco.salvar('sp_atual', conta);

/* ---------- Cálculo ---------- */
// Divide um valor em centavos de acordo com pesos, distribuindo o resto para não sobrar/faltar centavo
function repartir(valor, pesos) {
  const soma = pesos.reduce((s, p) => s + p, 0);
  if (!soma || !valor) return pesos.map(() => 0);
  const brutos = pesos.map((p) => (valor * p) / soma);
  const base = brutos.map(Math.floor);
  let resto = valor - base.reduce((s, x) => s + x, 0);
  const ordem = brutos.map((b, i) => [b - Math.floor(b), i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; resto > 0; k = (k + 1) % ordem.length, resto--) base[ordem[k][1]]++;
  return base;
}
function calcular() {
  const ps = conta.pessoas;
  if (!ps.length) return null;
  let consumo;
  if (conta.modo === 'itens') {
    consumo = ps.map(() => 0);
    conta.itens.forEach((it) => {
      const quem = it.quem.filter((id) => ps.some((p) => p.id === id));
      const alvo = quem.length ? quem : ps.map((p) => p.id);
      repartir(it.valor, ps.map((p) => (alvo.includes(p.id) ? 1 : 0))).forEach((v, i) => { consumo[i] += v; });
    });
  } else {
    const pesos = conta.modo === 'igual' ? ps.map(() => 1) : ps.map((p) => Math.max(0, p.peso || 0));
    consumo = repartir(conta.total, pesos);
  }
  const subtotal = consumo.reduce((s, x) => s + x, 0);
  const servico = conta.servico ? Math.round(subtotal * 0.1) : 0;
  const ajuste = servico + conta.extra - Math.min(conta.desconto, subtotal + servico + conta.extra);
  // taxa e desconto são distribuídos na mesma proporção do consumo
  const ajustes = ajuste >= 0 ? repartir(ajuste, consumo.some(Boolean) ? consumo : ps.map(() => 1)) : repartir(-ajuste, consumo).map((x) => -x);
  const deve = consumo.map((c, i) => c + ajustes[i]);
  const total = deve.reduce((s, x) => s + x, 0);

  // quanto cada um já pagou
  let pago = ps.map(() => 0);
  if (conta.pagou === 'um') pago = ps.map((p) => (p.id === conta.pagador ? total : 0));
  if (conta.pagou === 'varios') pago = ps.map((p) => conta.pagamentos[p.id] || 0);

  // acerto mínimo de contas: quem pagou menos repassa para quem pagou mais
  const saldos = ps.map((p, i) => ({ p, s: pago[i] - deve[i] }));
  const credores = saldos.filter((x) => x.s > 0).map((x) => ({ ...x })).sort((a, b) => b.s - a.s);
  const devedores = saldos.filter((x) => x.s < 0).map((x) => ({ ...x, s: -x.s })).sort((a, b) => b.s - a.s);
  const transf = [];
  if (conta.pagou !== 'ninguem') {
    let i = 0, j = 0;
    while (i < devedores.length && j < credores.length) {
      const v = Math.min(devedores[i].s, credores[j].s);
      if (v > 0) transf.push({ de: devedores[i].p, para: credores[j].p, v });
      devedores[i].s -= v; credores[j].s -= v;
      if (!devedores[i].s) i++;
      if (!credores[j].s) j++;
    }
  }
  return { consumo, deve, total, subtotal, servico, pagoTotal: pago.reduce((s, x) => s + x, 0), pago, transf };
}

/* ---------- Desenho ---------- */
function desenharPessoas() {
  $('#pessoas').innerHTML = conta.pessoas.map((p) => `<li class="pessoa">${avatar(p)}${escapar(p.nome)}<button class="x" data-tirar="${p.id}" aria-label="Remover ${escapar(p.nome)}">×</button></li>`).join('');
  $('#pagador').innerHTML = conta.pessoas.map((p) => `<option value="${p.id}" ${p.id === conta.pagador ? 'selected' : ''}>${escapar(p.nome)} pagou tudo</option>`).join('');
  if (!conta.pessoas.some((p) => p.id === conta.pagador) && conta.pessoas[0]) conta.pagador = conta.pessoas[0].id;
}
function desenharModo() {
  document.querySelector(`[name=modo][value=${conta.modo}]`).checked = true;
  $('#p-total').hidden = conta.modo === 'itens';
  $('#p-prop').hidden = conta.modo !== 'proporcional';
  $('#p-itens').hidden = conta.modo !== 'itens';
  $$('[data-peso]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.peso === conta.tipoPeso));
  const pct = conta.tipoPeso === 'pct';
  $('#pesos').innerHTML = conta.pessoas.map((p) => `<li>${avatar(p)}
      <input type="range" min="0" max="${pct ? 100 : 10}" step="1" value="${p.peso || 0}" data-peso-de="${p.id}" aria-label="Peso de ${escapar(p.nome)}">
      <input type="number" min="0" max="${pct ? 100 : 99}" value="${p.peso || 0}" data-peso-num="${p.id}" aria-label="${pct ? 'Porcentagem' : 'Partes'} de ${escapar(p.nome)}"></li>`).join('');
  const soma = conta.pessoas.reduce((s, p) => s + (p.peso || 0), 0);
  const av = $('#aviso-pct');
  if (pct) { av.textContent = soma === 100 ? '✓ Soma 100%' : `A soma está em ${soma}%. O cálculo ajusta proporcionalmente.`; av.classList.toggle('ok', soma === 100); }
  else { av.textContent = soma ? `Total de ${soma} partes` : 'Defina pelo menos 1 parte.'; av.classList.toggle('ok', !!soma); }
  desenharItens();
}
function desenharItens() {
  $('#itens').innerHTML = conta.itens.length ? conta.itens.map((it) => `<li class="item"><div class="item__topo"><span>${escapar(it.desc)} <small>${it.quem.length ? `· ${it.quem.length} ${it.quem.length === 1 ? 'pessoa' : 'pessoas'}` : '· todos'}</small></span><span>${brl(it.valor)} <button class="x" data-tirar-item="${it.id}" aria-label="Remover item">×</button></span></div>
      <div class="item__quem">${conta.pessoas.map((p) => `<button type="button" style="--c:${p.cor}" data-item="${it.id}" data-quem="${p.id}" aria-pressed="${it.quem.includes(p.id)}">${avatar(p)}${escapar(p.nome)}</button>`).join('')}</div></li>`).join('')
    : '<li class="nota">Nenhum item ainda. Adicione o que foi pedido.</li>';
}
function desenharPagamentos() {
  document.querySelector(`[name=pagou][value=${conta.pagou}]`).checked = true;
  $('#pagou-um').hidden = conta.pagou !== 'um';
  $('#pagou-varios').hidden = conta.pagou !== 'varios';
  $('#pagou-varios').innerHTML = conta.pessoas.map((p) => `<li>${avatar(p)}<span>${escapar(p.nome)} pagou</span><span class="moeda pequena"><span>R$</span><input inputmode="decimal" data-pago="${p.id}" value="${fmt(conta.pagamentos[p.id] || 0)}" placeholder="0,00" aria-label="Quanto ${escapar(p.nome)} pagou"></span></li>`).join('');
}
function desenharResumo() {
  const r = calcular();
  const box = $('#resumo');
  if (!r) { box.innerHTML = '<h2>Resumo</h2><p class="vazio">Adicione pelo menos uma pessoa.</p>'; return; }
  const ps = conta.pessoas, max = Math.max(1, ...r.deve);
  const partes = [`consumo ${brl(r.subtotal)}`];
  if (r.servico) partes.push(`serviço ${brl(r.servico)}`);
  if (conta.extra) partes.push(`extra ${brl(conta.extra)}`);
  if (conta.desconto) partes.push(`desconto −${brl(Math.min(conta.desconto, r.subtotal + r.servico + conta.extra))}`);
  const dif = conta.pagou === 'varios' ? r.pagoTotal - r.total : 0;
  $('#aviso-pago').textContent = conta.pagou === 'varios' && dif ? (dif < 0 ? `Faltam ${brl(-dif)} para fechar o total.` : `Pagaram ${brl(dif)} a mais que o total.`) : '';
  box.innerHTML = `
    <div><h2>${escapar(conta.nome || 'Total da conta')}</h2><div class="total">${brl(r.total)}</div><p class="composicao">${partes.join(' + ').replace('+ desconto', '· desconto')}</p></div>
    <div><h2>Cada um paga</h2><ul class="cotas">${ps.map((p, i) => `<li class="cota" style="--c:${p.cor}">${avatar(p)}<span>${escapar(p.nome)}<small>${r.total ? Math.round((r.deve[i] / r.total) * 100) : 0}% da conta${conta.pagou !== 'ninguem' && r.pago[i] ? ` · pagou ${brl(r.pago[i])}` : ''}</small></span><b>${brl(r.deve[i])}</b><span class="barra-cota"><i style="width:${(r.deve[i] / max) * 100}%"></i></span></li>`).join('')}</ul></div>
    ${conta.pagou !== 'ninguem' ? `<div><h2>Acerto de contas</h2><ul class="acertos">${r.transf.length ? r.transf.map((t) => `<li>${avatar(t.de)}<span>${escapar(t.de.nome)} → ${escapar(t.para.nome)}</span><b>${brl(t.v)}</b></li>`).join('') : '<li class="ok">Ninguém deve nada a ninguém. ✓</li>'}</ul></div>` : ''}
    <div class="btns"><button class="btn sec" id="copiar">Copiar resumo</button><button class="btn" id="salvar">Salvar divisão</button></div>`;
  salvar();
}
function desenharTudo() {
  $('#nome-conta').value = conta.nome;
  $('#total').value = fmt(conta.total);
  $('#servico').checked = conta.servico; $('#extra').value = fmt(conta.extra); $('#desconto').value = fmt(conta.desconto);
  desenharPessoas(); desenharModo(); desenharPagamentos(); desenharResumo();
}

function textoResumo() {
  const r = calcular();
  if (!r) return '';
  let t = `💸 ${conta.nome || 'Divisão da conta'}\nTotal: ${brl(r.total)}\n\n`;
  t += conta.pessoas.map((p, i) => `• ${p.nome}: ${brl(r.deve[i])}`).join('\n');
  if (r.transf.length) t += '\n\nAcerto:\n' + r.transf.map((x) => `→ ${x.de.nome} paga ${brl(x.v)} para ${x.para.nome}`).join('\n');
  return t + '\n\nFeito no SplitPay';
}

/* ---------- Eventos ---------- */
$('#form-pessoa').addEventListener('submit', (e) => {
  e.preventDefault();
  const nome = $('#nova-pessoa').value.trim();
  if (!nome) return;
  if (conta.pessoas.some((p) => p.nome.toLowerCase() === nome.toLowerCase())) { toast('Esse nome já está na lista'); return; }
  const id = Date.now();
  const n = conta.pessoas.length + 1;
  conta.pessoas.forEach((p) => { if (conta.tipoPeso === 'pct') p.peso = Math.round(100 / n); });
  conta.pessoas.push({ id, nome, cor: CORES[(conta.pessoas.length) % CORES.length], peso: conta.tipoPeso === 'pct' ? 100 - Math.round(100 / n) * (n - 1) : 1 });
  if (conta.pessoas.length === 1) conta.pagador = id;
  $('#nova-pessoa').value = '';
  desenharTudo(); $('#nova-pessoa').focus();
});
$('#pessoas').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tirar]');
  if (!b) return;
  const id = +b.dataset.tirar;
  conta.pessoas = conta.pessoas.filter((p) => p.id !== id);
  conta.itens.forEach((it) => { it.quem = it.quem.filter((q) => q !== id); });
  delete conta.pagamentos[id];
  desenharTudo();
});
$$('[name=modo]').forEach((r) => r.addEventListener('change', () => { conta.modo = r.value; desenharModo(); desenharResumo(); }));
$('#total').addEventListener('input', (e) => { conta.total = centavos(e.target.value); desenharResumo(); });
$('#extra').addEventListener('input', (e) => { conta.extra = centavos(e.target.value); desenharResumo(); });
$('#desconto').addEventListener('input', (e) => { conta.desconto = centavos(e.target.value); desenharResumo(); });
['#total', '#extra', '#desconto'].forEach((s) => $(s).addEventListener('blur', (e) => { e.target.value = fmt(centavos(e.target.value)); }));
$('#servico').addEventListener('change', (e) => { conta.servico = e.target.checked; desenharResumo(); });
$('#nome-conta').addEventListener('input', (e) => { conta.nome = e.target.value; desenharResumo(); });

$$('[data-peso]').forEach((b) => b.addEventListener('click', () => {
  conta.tipoPeso = b.dataset.peso;
  const n = conta.pessoas.length;
  conta.pessoas.forEach((p, i) => { p.peso = conta.tipoPeso === 'pct' ? (i === n - 1 ? 100 - Math.round(100 / n) * (n - 1) : Math.round(100 / n)) : 1; });
  desenharModo(); desenharResumo();
}));
$('#pesos').addEventListener('input', (e) => {
  const id = +(e.target.dataset.pesoDe || e.target.dataset.pesoNum);
  if (!id) return;
  const p = conta.pessoas.find((x) => x.id === id);
  p.peso = Math.max(0, Math.round(+e.target.value || 0));
  const par = e.target.dataset.pesoDe ? $(`[data-peso-num="${id}"]`) : $(`[data-peso-de="${id}"]`);
  par.value = p.peso;
  const soma = conta.pessoas.reduce((s, x) => s + (x.peso || 0), 0), av = $('#aviso-pct');
  if (conta.tipoPeso === 'pct') { av.textContent = soma === 100 ? '✓ Soma 100%' : `A soma está em ${soma}%. O cálculo ajusta proporcionalmente.`; av.classList.toggle('ok', soma === 100); }
  else { av.textContent = soma ? `Total de ${soma} partes` : 'Defina pelo menos 1 parte.'; av.classList.toggle('ok', !!soma); }
  desenharResumo();
});
$('#form-item').addEventListener('submit', (e) => {
  e.preventDefault();
  const desc = $('#item-desc').value.trim(), valor = centavos($('#item-valor').value);
  if (!desc || !valor) { toast('Informe o item e o valor'); return; }
  conta.itens.push({ id: Date.now(), desc, valor, quem: [] });
  $('#item-desc').value = ''; $('#item-valor').value = '';
  desenharItens(); desenharResumo(); $('#item-desc').focus();
});
$('#itens').addEventListener('click', (e) => {
  const q = e.target.closest('[data-quem]');
  if (q) {
    const it = conta.itens.find((x) => x.id === +q.dataset.item), id = +q.dataset.quem;
    it.quem = it.quem.includes(id) ? it.quem.filter((x) => x !== id) : [...it.quem, id];
    desenharItens(); desenharResumo(); return;
  }
  const x = e.target.closest('[data-tirar-item]');
  if (x) { conta.itens = conta.itens.filter((it) => it.id !== +x.dataset.tirarItem); desenharItens(); desenharResumo(); }
});
$$('[name=pagou]').forEach((r) => r.addEventListener('change', () => { conta.pagou = r.value; desenharPagamentos(); desenharResumo(); }));
$('#pagador').addEventListener('change', (e) => { conta.pagador = +e.target.value; desenharResumo(); });
$('#pagou-varios').addEventListener('input', (e) => { const id = e.target.dataset.pago; if (id) { conta.pagamentos[id] = centavos(e.target.value); desenharResumo(); } });

$('#resumo').addEventListener('click', async (e) => {
  if (e.target.id === 'copiar') { try { await navigator.clipboard.writeText(textoResumo()); toast('Resumo copiado! Cole no grupo.'); } catch { toast('Não foi possível copiar'); } }
  if (e.target.id === 'salvar') {
    const r = calcular();
    if (!r || !r.total) { toast('Informe os valores antes de salvar'); return; }
    conta.id ||= Date.now();
    const copia = { ...JSON.parse(JSON.stringify(conta)), salvoEm: Date.now(), totalFinal: r.total };
    const i = historico.findIndex((h) => h.id === conta.id);
    if (i >= 0) historico[i] = copia; else historico.unshift(copia);
    banco.salvar('sp_hist', historico); $('#n-hist').textContent = historico.length;
    toast('Divisão salva no histórico');
  }
});
$('#nova').addEventListener('click', () => {
  const pessoas = conta.pessoas.map((p) => ({ ...p }));
  conta = { id: null, nome: '', modo: 'igual', total: 0, servico: false, extra: 0, desconto: 0, tipoPeso: 'pct', pessoas, itens: [], pagou: 'um', pagador: pessoas[0]?.id || null, pagamentos: {} };
  desenharTudo(); $('#nome-conta').focus(); toast('Nova conta com as mesmas pessoas');
});

/* Histórico */
function desenharHist() {
  $('#lista-hist').innerHTML = historico.length ? historico.map((h) => `<li><b>${escapar(h.nome || 'Sem nome')}</b><b>${brl(h.totalFinal)}</b><small>${new Date(h.salvoEm).toLocaleDateString('pt-BR')} · ${h.pessoas.length} pessoas · ${{ igual: 'igual', proporcional: 'proporcional', itens: 'por itens' }[h.modo]}</small>
      <div class="botoes"><button data-abrir="${h.id}">Abrir</button><button class="perigo" data-del="${h.id}">Excluir</button></div></li>`).join('')
    : '<li class="nota">Nenhuma divisão salva ainda.</li>';
}
$('#abrir-hist').addEventListener('click', () => { desenharHist(); $('#dlg-hist').showModal(); });
$('#lista-hist').addEventListener('click', (e) => {
  const a = e.target.closest('[data-abrir]');
  if (a) { conta = JSON.parse(JSON.stringify(historico.find((h) => h.id === +a.dataset.abrir))); desenharTudo(); $('#dlg-hist').close(); toast('Divisão aberta'); return; }
  const d = e.target.closest('[data-del]');
  if (d) {
    if (d.textContent !== 'Confirmar') { d.textContent = 'Confirmar'; return; }
    historico = historico.filter((h) => h.id !== +d.dataset.del); banco.salvar('sp_hist', historico); $('#n-hist').textContent = historico.length; desenharHist();
  }
});
$$('[data-fechar]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
$('#dlg-hist').addEventListener('click', (e) => { if (e.target === $('#dlg-hist')) $('#dlg-hist').close(); });

let timerToast;
function toast(msg) { const t = $('#toast'); (document.querySelector('dialog[open]') || document.body).append(t); t.textContent = msg; t.hidden = false; clearTimeout(timerToast); timerToast = setTimeout(() => { t.hidden = true; }, 2400); }

$('#n-hist').textContent = historico.length;
desenharTudo();
