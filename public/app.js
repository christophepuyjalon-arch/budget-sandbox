// Budget — interface
'use strict';

const $ = (id) => document.getElementById(id);
const euros = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const eurosSigne = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', signDisplay: 'exceptZero' });
const fmt = (centimes) => euros.format((centimes || 0) / 100);
const fmtSigne = (centimes) => eurosSigne.format((centimes || 0) / 100);
const nomMois = (m) => new Date(`${m}-15T12:00:00`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
const nomJour = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const dateCourte = (iso) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const moisCourant = () => new Date().toISOString().slice(0, 7);
const decalerMois = (m, n) => { const d = new Date(`${m}-15T12:00:00`); d.setMonth(d.getMonth() + n); return d.toISOString().slice(0, 7); };
const echapper = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function lire(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }
function ecrire(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* stockage indisponible */ } }

const estInstallee = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const estIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

let moi = null;
let donnees = null;
let mois = moisCourant();
let invitationInstall = null;

class NonActive extends Error {}

async function api(chemin, options = {}) {
  const r = await fetch(chemin, {
    ...options,
    credentials: 'same-origin',
    headers: options.body ? { 'content-type': 'application/json' } : {},
  });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && chemin !== '/api/activer') throw new NonActive(d.erreur);
  if (!r.ok) throw new Error(d.erreur || `Erreur ${r.status}`);
  return d;
}

function statut(texte, auto = false) {
  $('statut').textContent = texte || '';
  if (auto) $('statut').dataset.auto = '1'; else delete $('statut').dataset.auto;
}

// ---------- démarrage ----------
async function demarrer() {
  const params = new URLSearchParams(location.search);
  const messageBanque = params.get('banque') === 'ok'
    ? `Banque connectée ✓${params.get('message') ? ` (${params.get('message')})` : ''}`
    : params.get('banque') === 'erreur' ? `Connexion à la banque impossible : ${params.get('message') || 'raison inconnue'}` : null;
  const codeInvitation = location.pathname.startsWith('/i/') ? decodeURIComponent(location.pathname.slice(3)) : null;
  if (messageBanque || codeInvitation) history.replaceState(null, '', '/');

  try {
    moi = (await api('/api/moi')).moi;
  } catch (e) {
    if (e instanceof NonActive) return afficherActivation(codeInvitation);
    // Hors ligne : on montre les dernières données connues.
    moi = lire('moi');
    if (!moi) return afficherActivation(codeInvitation);
  }
  ecrire('moi', moi);
  afficherApp();
  if (messageBanque) statut(messageBanque);
  if (params.get('banque') === 'erreur') afficherPage('reglages');
}

// ---------- activation ----------
function afficherActivation(code) {
  $('app').hidden = true;
  $('installer').hidden = true;
  $('activation').hidden = false;
  $('act-invitation').hidden = !code;
  if (code) $('code').value = code;
}

async function activerAvec(code, nom) {
  $('erreur-activation').textContent = '';
  try {
    const r = await api('/api/activer', { method: 'POST', body: JSON.stringify({ code, nom }) });
    moi = r.moi;
    ecrire('moi', moi);
    if (estInstallee()) afficherApp();
    else afficherGuideInstallation();
  } catch (e) {
    $('erreur-activation').textContent = e.message;
  }
}

$('btn-activer-invitation').addEventListener('click', () => activerAvec($('code').value, ''));
$('form-activation').addEventListener('submit', (e) => {
  e.preventDefault();
  activerAvec($('code').value, $('nom-appareil').value);
});

function afficherGuideInstallation() {
  $('activation').hidden = true;
  $('installer').hidden = false;
  const ios = estIOS();
  $('guide-ios').hidden = !ios;
  $('guide-android').hidden = ios;
  $('btn-installer').hidden = !invitationInstall;
  $('guide-android-menu').hidden = !!invitationInstall;
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  invitationInstall = e;
  if (!$('installer').hidden) { $('btn-installer').hidden = false; $('guide-android-menu').hidden = true; }
});
$('btn-installer').addEventListener('click', async () => {
  if (!invitationInstall) return;
  invitationInstall.prompt();
  await invitationInstall.userChoice.catch(() => null);
  invitationInstall = null;
  afficherApp();
});
$('btn-continuer').addEventListener('click', () => afficherApp());

// ---------- application ----------
function afficherApp() {
  $('activation').hidden = true;
  $('installer').hidden = true;
  $('app').hidden = false;
  $('moi-nom').textContent = moi ? `Activé au nom de ${moi.nom}${moi.admin ? ' (administrateur)' : ''}.` : '';
  $('bloc-banque').hidden = !moi?.admin;
  $('bloc-famille').hidden = !moi?.admin;
  const cache = lire(`etat:${mois}`);
  if (cache) { donnees = cache; dessiner(); }
  charger();
}

async function charger() {
  try {
    donnees = await api(`/api/etat?mois=${mois}`);
    ecrire(`etat:${mois}`, donnees);
    dessiner();
  } catch (e) {
    if (e instanceof NonActive) return afficherActivation(null);
    statut(donnees ? 'Hors ligne : dernières données connues.' : e.message);
  }
}

function dessiner() {
  const d = donnees;
  if (!d) return;
  if (!$('statut').textContent || $('statut').dataset.auto) {
    statut(d.synchro ? `Mis à jour ${depuis(d.synchro.date)}` : '', true);
  }
  dessinerAlertes(d);

  // Soldes
  const visibles = d.comptes.filter((c) => !c.masque);
  const total = visibles.reduce((s, c) => s + (c.solde || 0), 0);
  $('total').textContent = visibles.length ? fmt(total) : '–';
  $('total-detail').textContent = visibles.length ? `${visibles.length} compte${visibles.length > 1 ? 's' : ''}` : '';
  $('comptes').innerHTML = visibles.length
    ? visibles.map((c) => `<li><span class="nom">${echapper(c.nom)}<small>${echapper(c.banque)}${c.iban ? ` · ${echapper(c.iban)}` : ''}</small></span>
        <span class="montant ${c.solde < 0 ? 'negatif' : ''}">${c.solde == null ? '–' : fmt(c.solde)}</span></li>`).join('')
    : `<li class="vide">${moi?.admin ? 'Aucun compte : connecte ta banque dans Réglages.' : 'Aucun compte connecté pour l’instant.'}</li>`;

  // Mois
  $('mois-nom').textContent = nomMois(d.mois);
  $('mois-prec').disabled = d.mois <= d.premierMois;
  $('mois-suiv').disabled = d.mois >= moisCourant();
  const entrees = d.operations.filter((o) => o.montant > 0).reduce((s, o) => s + o.montant, 0);
  const sorties = d.operations.filter((o) => o.montant < 0).reduce((s, o) => s + o.montant, 0);
  $('entrees').textContent = fmt(entrees);
  $('sorties').textContent = fmt(-sorties);
  $('ecart').textContent = fmtSigne(entrees + sorties);
  $('ecart').className = entrees + sorties < 0 ? 'negatif' : 'positif';

  // Opérations, regroupées par jour
  const multi = d.comptes.length > 1;
  const nomsComptes = Object.fromEntries(d.comptes.map((c) => [c.id, c.nom]));
  let html = '', jourCourant = null;
  for (const o of d.operations) {
    if (o.date !== jourCourant) { jourCourant = o.date; html += `<h3 class="jour">${nomJour(o.date)}</h3>`; }
    const detail = [o.contrepartie && o.contrepartie !== o.libelle ? o.contrepartie : null, multi ? nomsComptes[o.compte] : null].filter(Boolean).join(' · ');
    html += `<div class="op ${o.statut === 'PDNG' ? 'encours' : ''}"><span class="libelle">${echapper(o.libelle)}</span>
      <span class="montant ${o.montant > 0 ? 'positif' : ''}">${fmtSigne(o.montant)}</span>${detail ? `<small>${echapper(detail)}</small>` : ''}</div>`;
  }
  $('operations').innerHTML = html || '<p class="vide">Aucune opération ce mois-ci.</p>';
}

function dessinerAlertes(d) {
  const alertes = [];
  const dans = (iso) => Math.round((Date.parse(iso) - Date.now()) / 86400000);
  for (const c of d.connexions) {
    if (c.statut !== 'active') {
      alertes.push({ grave: true, texte: `L’accès à ${c.banque} a expiré : les opérations ne se mettent plus à jour.`, banque: c });
    } else if (c.expire && dans(c.expire) <= 14) {
      alertes.push({ texte: `L’accès à ${c.banque} expire dans ${Math.max(dans(c.expire), 0)} jour(s).`, banque: c });
    }
  }
  if (d.synchro?.erreurs?.length) alertes.push({ texte: `Dernière synchro incomplète : ${d.synchro.erreurs.join(' · ')}` });
  $('alertes').innerHTML = alertes.map((a, i) => `<div class="alerte ${a.grave ? 'grave' : ''}">${echapper(a.texte)}
    ${a.banque && moi?.admin ? ` <button data-renouveler="${i}">Renouveler</button>` : a.banque ? ' Préviens l’administrateur.' : ''}</div>`).join('');
  $('alertes').querySelectorAll('[data-renouveler]').forEach((b) => b.addEventListener('click', () => renouveler(alertes[b.dataset.renouveler].banque)));
}

function depuis(iso) {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 2) return 'à l’instant';
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h} h`;
  return `le ${new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}`;
}

$('mois-prec').addEventListener('click', () => changerMois(-1));
$('mois-suiv').addEventListener('click', () => changerMois(1));
function changerMois(n) {
  mois = decalerMois(mois, n);
  const cache = lire(`etat:${mois}`);
  if (cache) { donnees = cache; dessiner(); }
  else $('operations').innerHTML = '<p class="vide">Chargement…</p>';
  charger();
}

$('btn-sync').addEventListener('click', async () => {
  const b = $('btn-sync');
  if (b.classList.contains('tourne')) return;
  b.classList.add('tourne');
  statut('Synchronisation avec la banque…');
  try {
    const r = await api('/api/sync', { method: 'POST' });
    statut(r.deja ? 'Déjà à jour.' : r.erreurs.length ? `Synchro incomplète : ${r.erreurs.join(' · ')}` : `Synchro terminée : ${r.comptes} compte(s).`);
    await charger();
  } catch (e) {
    if (e instanceof NonActive) return afficherActivation(null);
    statut(`Synchro impossible : ${e.message}`);
  } finally {
    b.classList.remove('tourne');
  }
});

// ---------- navigation ----------
document.querySelectorAll('.onglets button').forEach((b) => b.addEventListener('click', () => afficherPage(b.dataset.page)));
function afficherPage(nom) {
  document.querySelectorAll('.onglets button').forEach((b) => b.classList.toggle('actif', b.dataset.page === nom));
  $('page-accueil').hidden = nom !== 'accueil';
  $('page-reglages').hidden = nom !== 'reglages';
  scrollTo(0, 0);
  if (nom === 'reglages') dessinerReglages();
}

// ---------- réglages ----------
async function dessinerReglages() {
  if (!moi?.admin) return;
  const d = donnees || { connexions: [], comptes: [] };
  $('connexions').innerHTML = d.connexions.map((c) => {
    const n = d.comptes.filter((x) => x.connexion === c.id).length;
    const etat = c.statut === 'active' ? (c.expire ? `accès valable jusqu’au ${dateCourte(c.expire)}` : 'accès actif') : 'accès expiré';
    return `<li><div>${echapper(c.banque)}<small>${n} compte(s) · ${etat}</small></div>
      <span><button class="action" data-renouveler="${echapper(c.id)}">Renouveler</button>
      <button class="action danger" data-retirer="${echapper(c.id)}">Retirer</button></span></li>`;
  }).join('') || '<li class="vide">Aucune banque connectée.</li>';
  $('connexions').querySelectorAll('[data-renouveler]').forEach((b) => b.addEventListener('click', () => renouveler(d.connexions.find((c) => c.id === b.dataset.renouveler))));
  $('connexions').querySelectorAll('[data-retirer]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Retirer cette banque ? Ses comptes et opérations seront effacés de Budget.')) return;
    await api(`/api/connexions/${encodeURIComponent(b.dataset.retirer)}`, { method: 'DELETE' }).catch((e) => alert(e.message));
    await charger();
    dessinerReglages();
  }));

  try {
    const { appareils } = await api('/api/appareils');
    $('appareils').innerHTML = appareils.map((a) => `<li><div>${echapper(a.nom)}${a.moi ? ' (ce téléphone)' : ''}
      <small>${a.admin ? 'administrateur · ' : ''}vu ${depuis(a.vu)}</small></div>
      ${a.moi ? '' : `<button class="action danger" data-appareil="${echapper(a.id)}">Retirer</button>`}</li>`).join('');
    $('appareils').querySelectorAll('[data-appareil]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Retirer l’accès de ce téléphone ?')) return;
      await api(`/api/appareils/${encodeURIComponent(b.dataset.appareil)}`, { method: 'DELETE' }).catch((e) => alert(e.message));
      dessinerReglages();
    }));
  } catch (e) {
    $('appareils').innerHTML = `<li class="vide">${echapper(e.message)}</li>`;
  }
}

// Choix de la banque
let banques = null;
$('btn-connecter').addEventListener('click', async () => {
  $('choix-banque').hidden = false;
  $('btn-connecter').hidden = true;
  $('cherche-banque').focus();
  await chargerBanques();
});
async function chargerBanques() {
  $('banques').innerHTML = '<li class="vide">Chargement de la liste…</li>';
  try {
    banques = (await api(`/api/banques?pays=${$('pays-banque').value}`)).banques;
    listerBanques();
  } catch (e) {
    $('banques').innerHTML = `<li class="vide">${echapper(e.message)}</li>`;
  }
}
const sansAccent = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function listerBanques() {
  if (!banques) return;
  const q = sansAccent($('cherche-banque').value.trim());
  const liste = banques.filter((b) => !q || sansAccent(b.nom).includes(q)).slice(0, 60);
  $('banques').innerHTML = liste.map((b, i) => `<li><button data-i="${banques.indexOf(b)}">${b.logo ? `<img src="${echapper(b.logo)}" alt="" loading="lazy">` : ''}${echapper(b.nom)}</button></li>`).join('')
    || '<li class="vide">Aucune banque ne correspond.</li>';
  $('banques').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => connecter(banques[b.dataset.i])));
}
$('cherche-banque').addEventListener('input', listerBanques);
$('pays-banque').addEventListener('change', chargerBanques);

async function connecter(banque) {
  statut('Ouverture de la banque…');
  try {
    const { url } = await api('/api/banque/connecter', { method: 'POST', body: JSON.stringify(banque) });
    location.href = url;
  } catch (e) {
    alert(`Connexion impossible : ${e.message}`);
  }
}

async function renouveler(connexion) {
  try {
    const liste = banques || (await api(`/api/banques?pays=${encodeURIComponent(connexion.pays || 'FR')}`)).banques;
    const b = liste.find((x) => x.nom === connexion.banque) || { nom: connexion.banque, pays: connexion.pays };
    await connecter(b);
  } catch (e) {
    alert(`Renouvellement impossible : ${e.message}`);
  }
}

// Invitations
let lienInvitation = null;
$('form-invitation').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const r = await api('/api/invitations', { method: 'POST', body: JSON.stringify({ nom: $('nom-invite').value }) });
    lienInvitation = r.lien;
    const qr = qrcode(0, 'M');
    qr.addData(r.lien);
    qr.make();
    $('qr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
    $('code-invitation').textContent = r.code;
    $('expire-invitation').textContent = `Valable jusqu’au ${new Date(r.expire).toLocaleString('fr-FR', { weekday: 'long', hour: '2-digit', minute: '2-digit' })}.`;
    $('invitation').hidden = false;
  } catch (err) {
    alert(err.message);
  }
});
$('btn-partager').addEventListener('click', async () => {
  if (!lienInvitation) return;
  const texte = `Voici ton accès à Budget. Ouvre ce lien sur ton téléphone (dans Safari sur iPhone) : ${lienInvitation}`;
  if (navigator.share) {
    await navigator.share({ title: 'Budget', text: texte }).catch(() => {});
  } else {
    await navigator.clipboard?.writeText(lienInvitation).catch(() => {});
    alert('Lien copié.');
  }
});

$('btn-deconnexion').addEventListener('click', async () => {
  if (!confirm('Désactiver ce téléphone ? Il faudra un nouveau code pour y revenir.')) return;
  await api('/api/deconnexion', { method: 'POST' }).catch(() => {});
  try { localStorage.clear(); } catch { /* rien */ }
  location.href = '/';
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
demarrer();
