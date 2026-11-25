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
const isoLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const aujourdhui = () => isoLocal(new Date());
const moisCourant = () => aujourdhui().slice(0, 7);
const decalerMois = (m, n) => { const d = new Date(`${m}-15T12:00:00`); d.setMonth(d.getMonth() + n); return isoLocal(d).slice(0, 7); };
const joursDansMois = (m) => new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0).getDate();
const echapper = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function lire(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }
function ecrire(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* stockage indisponible */ } }

const estInstallee = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const estIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

let moi = null;
let donnees = null;
let mois = moisCourant();
let invitationInstall = null;
let filtre = 'toutes';

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


// ---------- classement des opérations ----------
// Tout le classement se fait sur le téléphone : le serveur ne garde que les choix manuels.

const normaliser = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
// Pour comparer libellés et motifs, la ponctuation compte comme un espace :
// « PPG*N LAB », « Aroma-Zone » et « AROMA ZONE » se ressemblent.
const sansPonctuation = (t) => normaliser(t).replace(/[^A-Z0-9&]+/g, ' ').trim();
const echapperRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

let reglesPretes = null;
function preparerRegles(d) {
  const cats = new Set(d.categories.map((c) => c.id));
  reglesPretes = d.regles
    .filter((r) => (cats.has(r.categorie) || (!r.categorie && r.note)) && r.motif.trim())
    .map((r) => ({ ...r, re: new RegExp(`(^|[^A-Z])${echapperRegex(sansPonctuation(r.motif))}S?(?=[^A-Z]|$)`) }))
    // Tes règles d'abord, puis le motif le plus long (le plus précis).
    .sort((a, b) => (a.source === 'perso' ? 0 : 1) - (b.source === 'perso' ? 0 : 1)
      || (a.montant != null ? 0 : 1) - (b.montant != null ? 0 : 1) || b.motif.trim().length - a.motif.trim().length);
}

const regleVaut = (r, o, texte) => r.re.test(texte) && (r.montant == null || Math.abs(o.montant) === r.montant);

// Commentaire : celui saisi sur l'opération, sinon celui d'une règle.
function noteDe(o) {
  if (o.note) return o.note;
  const texte = sansPonctuation(`${o.libelle} ${o.contrepartie || ''}`);
  for (const r of reglesPretes) if (r.note && regleVaut(r, o, texte)) return r.note;
  return null;
}

function categorieDe(o, d) {
  if (o.categorie && d.categories.some((c) => c.id === o.categorie)) return o.categorie;
  const texte = sansPonctuation(`${o.libelle} ${o.contrepartie || ''}`);
  for (const r of reglesPretes) if (r.categorie && regleVaut(r, o, texte)) return r.categorie;
  return o.montant > 0 && d.categories.some((c) => c.id === 'revenus') ? 'revenus' : null;
}

// Motif proposé pour « toujours classer ainsi » : le commerçant, sans les mots bancaires.
function motifPropose(o) {
  const base = normaliser(o.contrepartie || o.libelle)
    .replace(/\b(PAIEMENT|CB|CARTE|PRLV|SEPA|VIR|VIREMENT|INST|RETRAIT|DAB|ACHAT|FACT|DU|LE)\b/g, ' ')
    .replace(/\bX?\d[\d/.:-]*\b/g, ' ')
    .replace(/[^A-Z0-9&' ]/g, ' ')
    .replace(/\s+/g, ' ').trim();
  return base.split(' ').slice(0, 3).join(' ');
}

const nomCarte = (d, carte) => {
  const nom = d.nomsCartes?.[carte];
  return carte === '?' ? 'Carte' : `Carte …${carte}${nom ? ` (${nom})` : ''}`;
};
const typeCompte = (d, id) => d.comptes.find((c) => c.id === id)?.type || 'courant';
const nomCategorie = (d, id) => d.categories.find((c) => c.id === id)?.nom || 'À classer';

// Calcule tous les indicateurs du mois affiché.
function calculer(d) {
  preparerRegles(d);
  const enCours = d.mois === moisCourant();
  const passe = d.mois < moisCourant();
  const jour = enCours ? new Date().getDate() : passe ? joursDansMois(d.mois) : 0;
  const nbJours = joursDansMois(d.mois);
  const fraction = enCours ? jour / nbJours : passe ? 1 : 0;

  const parCat = Object.fromEntries(d.categories.map((c) => [c.id, 0]));
  const ops = [];
  let aClasser = 0;
  // Les mois passés n'ont souvent pas le détail des paiements carte (la banque ne le transmet plus
  // une fois débité) : le prélèvement du mois suivant compte alors comme dépense du mois.
  const detailCartes = d.operations.some((o) => o.carte && o.date.startsWith(d.mois));
  let cartesSansDetail = 0;
  const debitsCartes = [];
  if (!detailCartes) {
    for (const o of d.operations) {
      if (o.date > `${d.mois}-31` && o.montant < 0 && typeCompte(d, o.compte) !== 'epargne' && categorieDe(o, d) === 'differe') {
        cartesSansDetail -= o.montant;
        debitsCartes.push({ ...o, cat: 'differe', projetNom: null, epargne: false });
      }
    }
  }
  let depenseAClasser = 0;
  for (const o of d.operations) {
    if (!o.date.startsWith(d.mois)) continue;     // début du mois suivant : sert seulement au prélèvement carte
    const epargne = typeCompte(d, o.compte) === 'epargne';
    const projet = o.projet ? d.projets.find((p) => p.id === o.projet) : null;
    const cat = epargne ? null : categorieDe(o, d);
    const x = { ...o, cat, projetNom: projet?.nom || null, epargne, commentaire: noteDe(o) };
    ops.push(x);
    if (epargne || projet) continue;
    if (cat) parCat[cat] -= o.montant;
    else { aClasser++; depenseAClasser -= o.montant; }
  }

  const cats = d.categories.map((c) => ({ ...c, depense: parCat[c.id] || 0 }));
  const budgetes = cats.filter((c) => c.type === 'fixe' || c.type === 'enveloppe');
  const enveloppes = cats.filter((c) => c.type === 'enveloppe');
  const totalBudget = budgetes.reduce((s, c) => s + c.budget, 0);
  // Ce qui n'est pas encore classé et les cartes sans détail comptent aussi : ce sont des dépenses réelles.
  const totalDepense = budgetes.reduce((s, c) => s + Math.max(c.depense, 0), 0) + Math.max(depenseAClasser, 0) + cartesSansDetail;
  const resteEnveloppes = enveloppes.reduce((s, c) => s + Math.max(c.budget - c.depense, 0), 0);
  const joursRestants = enCours ? nbJours - jour + 1 : 0;

  // Disponible = comptes courants − paiements carte pas encore débités (débit différé).
  let courant = 0, epargne = 0;
  for (const c of d.comptes.filter((x) => !x.masque)) {
    if (c.type === 'epargne') epargne += c.solde || 0;
    else courant += c.solde || 0;
  }
  const encoursParCarte = {};
  for (const e of d.encours || []) encoursParCarte[e.carte || '?'] = (encoursParCarte[e.carte || '?'] || 0) + e.montant;
  const encours = Object.values(encoursParCarte).reduce((t, v) => t + v, 0);
  return {
    enCours, passe, jour, nbJours, fraction, cats, ops, aClasser, totalBudget, totalDepense,
    resteEnveloppes, joursRestants, courant, encours, encoursParCarte, epargne,
    revenus: parCat.revenus || 0, depenseAClasser, cartesSansDetail, debitsCartes,
  };
}

// ---------- application ----------
function afficherApp() {
  $('activation').hidden = true;
  $('installer').hidden = true;
  $('app').hidden = false;
  $('moi-nom').textContent = moi ? `Activé au nom de ${moi.nom}${moi.admin ? ' (administrateur)' : ''}.` : '';
  for (const id of ['bloc-banque', 'bloc-famille', 'bloc-budgets', 'bloc-comptes']) $(id).hidden = !moi?.admin;
  const cache = lire(`etat:${mois}`);
  if (cache?.categories) { donnees = cache; dessiner(); }
  charger();
  // Guide rapide : ouvert tout seul la première fois sur les téléphones invités.
  if (moi && !moi.admin && !lire('guide-vu')) setTimeout(() => ouvrirGuide(), 600);
}

async function charger({ garderHistorique = false } = {}) {
  try {
    donnees = await api(`/api/etat?mois=${mois}`);
    ecrire(`etat:${mois}`, donnees);
    if (!garderHistorique) historique = null;   // une modification a pu changer le classement
    dessiner();
    rafraichirVuesHistorique();
  } catch (e) {
    if (e instanceof NonActive) return afficherActivation(null);
    statut(donnees ? 'Hors ligne : dernières données connues.' : e.message);
  }
}

let calcul = null;
function dessiner() {
  const d = donnees;
  if (!d?.categories) return;
  calcul = calculer(d);
  if (!$('statut').textContent || $('statut').dataset.auto) statut(d.synchro ? `Mis à jour ${depuis(d.synchro.date)}` : '', true);
  dessinerAlertes(d);
  document.querySelectorAll('.mois-nom').forEach((e) => { e.textContent = nomMois(d.mois); });
  document.querySelectorAll('.mois-prec').forEach((b) => { b.disabled = d.mois <= d.premierMois; });
  document.querySelectorAll('.mois-suiv').forEach((b) => { b.disabled = d.mois >= moisCourant(); });
  dessinerAccueil(d, calcul);
  dessinerOperations(d, calcul);
  $('section-prevision').hidden = d.mois !== moisCourant() || !d.comptes.length;
  if (!$('page-projets').hidden) dessinerPageProjets();
  if (d.mois !== moisCourant()) majLigneAtterrissage();
  if (d.mois === moisCourant()) dessinerPrevision();
  if (!$('page-reglages').hidden) dessinerReglages();
}

// ---------- Aujourd'hui ----------
function dessinerAccueil(d, k) {
  // Le grand chiffre = ce qui reste pour le quotidien (les enveloppes), le seul poste
  // sur lequel on agit au jour le jour. Les charges fixes et le total passent en dessous.
  const reste = k.totalBudget - k.totalDepense;
  const fixes = k.cats.filter((c) => c.type === 'fixe');
  const fixesBudget = fixes.reduce((t, c) => t + c.budget, 0);
  const fixesPasses = fixes.reduce((t, c) => t + Math.max(c.depense, 0), 0);
  const fixesAVenir = fixes.reduce((t, c) => t + Math.max(c.budget - c.depense, 0), 0);
  const libre = reste - fixesAVenir;   // les « à classer » en sont déjà déduits
  const noms = k.cats.filter((c) => c.type === 'enveloppe').map((c) => c.nom.toLowerCase());
  const liste = noms.length > 1 ? `${noms.slice(0, -1).join(', ')}, ${noms[noms.length - 1]}` : noms[0] || '';
  const depasse = libre < 0;
  const quand = k.titre ? ` prévu le ${k.titre.replace(/^Reste prévu le /, '')}` : '';
  $('reste-titre').textContent = depasse ? `Quotidien${quand} : dépassé de` : k.passe ? 'Quotidien : reste du mois' : `Reste pour le quotidien${quand}`;
  $('reste').textContent = fmt(Math.abs(libre));
  $('reste').classList.toggle('negatif', depasse);
  const aClasser = Math.max(k.depenseAClasser || 0, 0);
  $('reste-detail').textContent = [liste, aClasser ? `dont ${fmt(aClasser)} à classer` : ''].filter(Boolean).join(' · ');
  const lignes = [];
  if (depasse && k.enCours && !k.titre) lignes.push('Chaque dépense d’ici la fin du mois creuse le dépassement.');
  if (fixesBudget) lignes.push(`Charges fixes : ${fmt(fixesPasses)} passées sur ${fmt(fixesBudget)}${fixesAVenir ? ` · ${fmt(fixesAVenir)} encore à venir` : ' ✓'}`);
  lignes.push(`Budget du mois : ${fmt(k.totalDepense)} dépensés sur ${fmt(k.totalBudget)}${k.enCours && !k.titre ? ` · jour ${k.jour}/${k.nbJours}` : ''}${k.titre ? ' · projection au rythme habituel' : ''}`);
  $('par-jour').innerHTML = lignes.map((l) => `<span>${echapper(l)}</span>`).join('');
  $('par-jour').classList.remove('negatif');

  $('lien-a-classer').hidden = !k.aClasser;
  $('lien-a-classer').textContent = `${k.aClasser} opération${k.aClasser > 1 ? 's' : ''} à classer ›`;

  // Anneaux des enveloppes : rempli = dépensé, repère = rythme attendu à cette date.
  const env = k.cats.filter((c) => c.type === 'enveloppe');
  $('anneaux').innerHTML = env.map((c) => {
    const attendu = Math.round(c.budget * k.fraction);
    const ecart = attendu - c.depense;
    const etat = c.depense > c.budget ? 'depasse' : c.depense > attendu ? 'avance' : 'ok';
    // Un seul message, le plus utile au moment d'acheter : ce qui reste, et par jour.
    const resteC = c.budget - c.depense;
    const message = c.budget === 0 ? 'Sans budget'
      : etat === 'depasse' ? `Dépassé de ${fmt(-resteC)}`
      : k.enCours && !k.titre && k.joursRestants > 1 ? `Reste ${fmt(resteC)} · ${fmt(resteC / k.joursRestants)}/jour`
      : `Reste ${fmt(resteC)}`;
    return `<button class="anneau ${etat}" data-cat="${echapper(c.id)}">
      ${svgAnneau(c.budget ? c.depense / c.budget : 0, k.enCours ? k.fraction : null)}
      <span class="anneau-pct">${c.budget ? Math.round((c.depense / c.budget) * 100) : 0} %</span>
      <span class="anneau-nom">${echapper(c.nom)}</span>
      <span class="anneau-montant">${fmt(c.depense)} / ${fmt(c.budget)}</span>
      <span class="anneau-etat">${message}</span></button>`;
  }).join('') || '<p class="vide">Aucune enveloppe : ajoute-en dans Réglages.</p>';

  $('fixes').innerHTML = k.cats.filter((c) => c.type === 'fixe').map((c) => barre(c.nom, c.depense, c.budget,
    c.depense >= c.budget * 0.98 ? 'Passé ✓' : `Reste ${fmt(c.budget - c.depense)}`, c.id)).join('');

  // Projets en cours et à venir (non archivés), face au solde du livret projets.
  const projets = d.projets.filter((p) => !p.archive && p.fin >= decalerMois(d.mois, -1));
  $('section-projets').hidden = !projets.length && !d.livret;
  const plan = planProjets(d);
  // Une seule ligne sur l'accueil : le détail est dans l'onglet Projets. Rouge si le plan coince.
  $('resume-livret').classList.toggle('alerte-projets', !!plan.premierNegatif);
  $('resume-livret').innerHTML = `<span>Livret projets${d.livret?.solde != null ? ` : <b>${fmt(d.livret.solde)}</b>` : ''}</span>
    <span>${resumePlan(plan)} ›</span>`;

  const suivi = k.cats.filter((c) => c.type === 'suivi' && c.depense);
  if (k.depenseAClasser > 0) suivi.unshift({ id: '__aclasser', nom: 'À classer (compté dans le reste)', depense: k.depenseAClasser });
  if (k.cartesSansDetail) suivi.unshift({ id: 'differe', nom: 'Cartes, détail non transmis par la banque', depense: k.cartesSansDetail });
  if (k.revenus) suivi.push({ id: 'revenus', nom: 'Revenus du mois', depense: -k.revenus, revenu: true });
  $('section-suivi').hidden = !suivi.length;
  $('suivi').innerHTML = suivi.map((c) => `<li><button data-cat="${echapper(c.id)}"><span>${echapper(c.nom)}</span>
    <b class="${c.revenu ? 'positif' : ''}">${fmt(Math.abs(c.depense))}</b></button></li>`).join('');

  // Comptes
  const visibles = d.comptes.filter((c) => !c.masque);
  $('dispo').textContent = visibles.length ? fmt(k.courant - k.encours) : '–';
  $('dispo-detail').textContent = !visibles.length ? '' : k.encours
    ? `solde ${fmt(k.courant)} − cartes à débiter ${fmt(k.encours)}`
    : 'sur les comptes courants';
  const ordre = { courant: 0, carte: 0, epargne: 2 };
  const lignesCartes = Object.entries(k.encoursParCarte).filter(([, v]) => v).map(([carte, v]) =>
    `<li class="cliquable" data-carte-ops="${echapper(carte)}"><span class="nom">${echapper(nomCarte(d, carte))}<small>paiements à débiter (débit différé) ›</small></span>
      <span class="montant">−${fmt(v)}</span></li>`);
  $('comptes').innerHTML = visibles.length
    ? [...visibles].sort((a, b) => ordre[a.type] - ordre[b.type]).map((c) => {
      const detail = c.type === 'epargne' ? 'épargne' : c.banque;
      return `<li><span class="nom">${echapper(c.nom)}<small>${echapper(detail)}${c.iban ? ` · ${echapper(c.iban)}` : ''}</small></span>
        <span class="montant ${c.solde < 0 ? 'negatif' : ''}">${c.solde == null ? '–' : fmt(c.solde)}</span></li>`;
    }).concat(lignesCartes).join('')
    : `<li class="vide">${moi?.admin ? 'Aucun compte : connecte ta banque dans Réglages.' : 'Aucun compte connecté pour l’instant.'}</li>`;
}

function svgAnneau(part, repere) {
  const r = 30, c = 2 * Math.PI * r;
  const p = Math.min(Math.max(part, 0), 1);
  let marque = '';
  if (repere != null) {
    const a = repere * 2 * Math.PI - Math.PI / 2;
    const [x1, y1, x2, y2] = [36 + 24 * Math.cos(a), 36 + 24 * Math.sin(a), 36 + 36 * Math.cos(a), 36 + 36 * Math.sin(a)];
    marque = `<line class="repere" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
  }
  return `<svg viewBox="0 0 72 72" aria-hidden="true"><circle class="piste" cx="36" cy="36" r="${r}"/>
    <circle class="rempli" cx="36" cy="36" r="${r}" stroke-dasharray="${(p * c).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 36 36)"/>${marque}</svg>`;
}

function barre(nom, depense, budget, detail, cat) {
  const part = budget ? Math.min(Math.max(depense / budget, 0), 1) : 0;
  const etat = depense > budget ? 'depasse' : '';
  const attr = cat ? ` data-cat="${echapper(cat)}"` : '';
  return `<li><button${attr} class="${etat}"><span class="barre-haut"><span>${echapper(nom)}</span><b>${fmt(depense)} <small>/ ${fmt(budget)}</small></b></span>
    <span class="jauge"><i style="width:${(part * 100).toFixed(1)}%"></i></span><small>${echapper(detail)}</small></button></li>`;
}

const moisCourt = (m) => new Date(`${m}-15T12:00:00`).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });
const periode = (p) => (p.debut === p.fin ? moisCourt(p.debut) : `${moisCourt(p.debut)} → ${moisCourt(p.fin)}`);

// Toucher une enveloppe ou une ligne : voir ses opérations.
let filtreCat = null;
$('page-accueil').addEventListener('click', (e) => {
  const b = e.target.closest('[data-cat]');
  if (!b) return;
  if (b.dataset.cat === '__aclasser') { filtre = 'aclasser'; afficherPage('operations'); return; }
  filtreCat = b.dataset.cat;
  filtre = 'categorie';
  afficherPage('operations');
});
$('lien-a-classer').addEventListener('click', () => { filtre = 'aclasser'; afficherPage('operations'); });

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

document.querySelectorAll('.mois-prec').forEach((b) => b.addEventListener('click', () => changerMois(-1)));
document.querySelectorAll('.mois-suiv').forEach((b) => b.addEventListener('click', () => changerMois(1)));
function changerMois(n) {
  mois = decalerMois(mois, n);
  const cache = lire(`etat:${mois}`);
  if (cache?.categories) { donnees = cache; dessiner(); }
  else $('operations').innerHTML = '<p class="vide">Chargement…</p>';
  charger({ garderHistorique: true });
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

// ---------- Opérations ----------
function dessinerOperations(d, k) {
  dessinerPuces(d, k);
  let liste = k.ops;
  let titreFiltre = '';
  if (filtre !== 'toutes') {
    liste = filtre === 'categorie' && filtreCat === 'differe' && k.cartesSansDetail ? k.debitsCartes : liste.filter(passeFiltre);
    const total = liste.reduce((t, o) => t + o.montant, 0);
    titreFiltre = `<p class="filtre-actif"><span>${echapper(nomFiltre(d))} · ${liste.length} opération${liste.length > 1 ? 's' : ''} · <b>${fmtSigne(total)}</b></span>
      <button data-filtre="toutes">× tout</button></p>`;
  }
  const entrees = k.ops.filter((o) => o.montant > 0).reduce((s, o) => s + o.montant, 0);
  const sorties = k.ops.filter((o) => o.montant < 0).reduce((s, o) => s + o.montant, 0);
  $('entrees').textContent = fmt(entrees);
  $('sorties').textContent = fmt(-sorties);
  $('ecart').textContent = fmtSigne(entrees + sorties);
  $('ecart').className = entrees + sorties < 0 ? 'negatif' : 'positif';

  let html = titreFiltre, jourCourant = null;
  opsAffichees.clear();
  for (const o of liste) {
    if (o.date !== jourCourant) { jourCourant = o.date; html += `<h3 class="jour">${nomJour(o.date)}</h3>`; }
    html += htmlOp(o, d);
  }
  $('operations').innerHTML = html || `<p class="vide">${filtre === 'aclasser' ? 'Tout est classé ✓' : 'Aucune opération.'}</p>`;
}

// Une ligne d'opération (liste du mois et résultats de recherche).
const opsAffichees = new Map();
function htmlOp(o, d, avecDate = false) {
  opsAffichees.set(o.id, o);
  const etiquette = o.epargne ? 'Épargne' : o.projetNom ? `Projet · ${o.projetNom}` : o.cat ? nomCategorie(d, o.cat) : 'À classer';
  const nomCompte = d.comptes.length > 1 ? d.comptes.find((c) => c.id === o.compte)?.nom : null;
  const detail = [avecDate ? new Date(`${o.date}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : null,
    o.contrepartie && o.contrepartie !== o.libelle ? o.contrepartie : null,
    o.carte ? nomCarte(d, o.carte) : nomCompte].filter(Boolean).join(' · ');
  return `<button class="op ${o.statut === 'PDNG' ? 'encours' : o.statut === 'AVNR' ? 'adebiter' : ''}" data-op="${echapper(o.id)}">
    <span class="libelle">${echapper(o.libelle)}</span>
    <span class="montant ${o.montant > 0 ? 'positif' : ''}">${fmtSigne(o.montant)}</span>
    ${o.commentaire ? `<span class="note">${echapper(o.commentaire)}</span>` : ''}
    <span class="puce-cat ${!o.cat && !o.projetNom && !o.epargne ? 'vide' : ''} ${o.categorie || (o.projet && o.projet !== '') ? 'manuel' : ''}">${echapper(etiquette)}</span>
    ${detail ? `<small>${echapper(detail)}</small>` : ''}</button>`;
}

// ---- puces de filtre (catégorie, à classer, projet), communes au mois et à la recherche
function passeFiltre(o) {
  if (filtre === 'carte') return o.carte === filtreCat && o.statut === 'AVNR';
  if (filtre === 'aclasser') return !o.cat && !o.projet && !o.epargne;
  if (filtre === 'projet') return o.projet === filtreCat;
  if (filtre === 'categorie') return filtreCat === 'revenus' ? o.cat === 'revenus' && !o.projet : o.cat === filtreCat && !o.projet && !o.epargne;
  return true;
}
function nomFiltre(d) {
  if (filtre === 'carte') return `${nomCarte(d, filtreCat)} · à débiter`;
  if (filtre === 'aclasser') return 'À classer';
  if (filtre === 'projet') return `Projet · ${d.projets.find((p) => p.id === filtreCat)?.nom || ''}`;
  return nomCategorie(d, filtreCat);
}
const cleFiltre = () => (filtre === 'toutes' ? '' : filtre === 'aclasser' ? 'a' : `${{ projet: 'p', carte: 'k' }[filtre] || 'c'}:${filtreCat}`);
function choisirFiltre(cle) {
  if (!cle) filtre = 'toutes';
  else if (cle === 'a') filtre = 'aclasser';
  else { filtre = { p: 'projet', k: 'carte' }[cle[0]] || 'categorie'; filtreCat = cle.slice(2); }
  rechercher();
  dessiner();
}
function dessinerPuces(d, k) {
  // Montant du mois sur chaque puce : on voit d'un coup d'œil où part l'argent.
  const parCat = {};
  for (const o of k.ops) if (!o.projet && !o.epargne && o.cat) parCat[o.cat] = (parCat[o.cat] || 0) + o.montant;
  const puces = [['', 'Toutes', null], ['a', `À classer${k.aClasser ? ` · ${k.aClasser}` : ''}`, null]];
  for (const c of d.categories) {
    const v = parCat[c.id] || 0;
    if (!v && c.type !== 'enveloppe' && c.type !== 'fixe') continue;
    puces.push([`c:${c.id}`, c.nom, v]);
  }
  for (const p of d.projets.filter((x) => !x.archive)) puces.push([`p:${p.id}`, `Projet · ${p.nom}`, null]);
  // Cartes : paiements pas encore débités (sur plusieurs mois : recherche dans l'historique).
  const parCarte = {};
  for (const e of d.encours || []) if (e.carte) parCarte[e.carte] = (parCarte[e.carte] || 0) + e.montant;
  for (const [c, v] of Object.entries(parCarte)) if (v) puces.push([`k:${c}`, `${nomCarte(d, c)} · à débiter`, v]);
  const actif = cleFiltre();
  $('puces-filtre').innerHTML = puces.map(([cle, nom, v]) => `<button data-cle="${echapper(cle)}" class="${cle === actif ? 'actif' : ''} ${cle === 'a' && k.aClasser ? 'alerte-puce' : ''}" aria-pressed="${cle === actif}">
    ${echapper(nom)}${v ? ` <small>${fmtCourt(Math.abs(v))}</small>` : ''}</button>`).join('');
  $('puces-filtre').querySelector('.actif')?.scrollIntoView({ block: 'nearest', inline: 'center' });
}
$('puces-filtre').addEventListener('click', (e) => { const b = e.target.closest('[data-cle]'); if (b) choisirFiltre(b.dataset.cle); });
$('operations').addEventListener('click', (e) => {
  if (e.target.closest('[data-filtre]')) { choisirFiltre(''); return; }
  const b = e.target.closest('[data-op]');
  if (b) ouvrirFiche(opsAffichees.get(b.dataset.op));
});

// ---------- fiche d'une opération ----------
let ficheOp = null, ficheCat = null;
function ouvrirFiche(o) {
  if (!o) return;
  const d = donnees;
  ficheOp = o;
  ficheCat = o.cat;
  $('fiche-date').textContent = nomJour(o.date);
  $('fiche-libelle').textContent = o.libelle;
  $('fiche-montant').textContent = fmtSigne(o.montant);
  $('fiche-montant').className = `fiche-montant ${o.montant > 0 ? 'positif' : ''}`;
  $('fiche-compte').textContent = [o.contrepartie, o.carte ? nomCarte(d, o.carte) : null, d.comptes.find((c) => c.id === o.compte)?.nom,
    o.statut === 'PDNG' ? 'en cours' : o.statut === 'AVNR' ? 'pas encore débité' : null].filter(Boolean).join(' · ');
  $('fiche-categories').innerHTML = d.categories.map((c) => `<button type="button" role="radio" aria-checked="${c.id === ficheCat}" data-c="${echapper(c.id)}">${echapper(c.nom)}</button>`).join('');
  $('fiche-regle').hidden = true;
  $('fiche-motif').value = motifPropose(o);
  $('fiche-note').value = o.commentaire || '';
  $('fiche-montant-seul').checked = false;
  $('fiche-montant-seul-texte').textContent = `Seulement pour ce montant (${fmt(Math.abs(o.montant))})`;
  majFicheRecurrente();
  const projets = d.projets.filter((p) => !p.archive || p.id === o.projet);
  $('fiche-projet').innerHTML = `<option value="">Aucun</option>` + projets.map((p) => `<option value="${echapper(p.id)}">${echapper(p.nom)}</option>`).join('');
  $('fiche-projet').value = o.projet || '';
  $('fiche-technique').hidden = !moi?.admin;
  $('fiche-technique').open = false;
  $('fiche-brut').textContent = 'Chargement…';
  $('fiche').showModal();
}
$('fiche-technique').addEventListener('toggle', async () => {
  if (!$('fiche-technique').open || !ficheOp) return;
  try {
    const { brut } = await api(`/api/operations/${encodeURIComponent(ficheOp.id)}`);
    $('fiche-brut').textContent = JSON.stringify(brut, null, 2);
  } catch (e) { $('fiche-brut').textContent = e.message; }
});
$('fiche-categories').addEventListener('click', (e) => {
  const b = e.target.closest('[data-c]');
  if (!b) return;
  ficheCat = b.dataset.c;
  $('fiche-categories').querySelectorAll('[data-c]').forEach((x) => x.setAttribute('aria-checked', String(x.dataset.c === ficheCat)));
  majBlocRegle();
});
$('fiche-note').addEventListener('input', majBlocRegle);
function majBlocRegle() {
  const cat = ficheCat !== ficheOp.cat;
  const note = $('fiche-note').value.trim() !== (ficheOp.commentaire || '');
  $('fiche-regle').hidden = !(cat || note) || !$('fiche-motif').value;
  $('fiche-toujours-texte').textContent = cat && note ? 'Même catégorie et même commentaire pour les opérations contenant :'
    : cat ? 'Toujours classer ainsi les opérations contenant :' : 'Ajouter ce commentaire aux opérations contenant :';
}
$('fiche').addEventListener('close', async () => {
  if ($('fiche').returnValue !== 'ok' || !ficheOp) return;
  const o = ficheOp;
  const corps = {};
  if (ficheCat !== o.cat) corps.categorie = ficheCat;
  const projet = $('fiche-projet').value;
  if (projet !== (o.projet || '')) corps.projet = projet || (o.projet ? '' : null);
  const note = $('fiche-note').value.trim();
  const noteChange = note !== (o.commentaire || '');
  if (noteChange) corps.note = note;
  try {
    const regle = !$('fiche-regle').hidden && $('fiche-toujours').checked && $('fiche-motif').value.trim().length >= 3;
    if (regle) {
      const r = { motif: $('fiche-motif').value };
      if ($('fiche-montant-seul').checked) r.montant = Math.abs(o.montant);
      if ('categorie' in corps) r.categorie = ficheCat;
      if (noteChange) r.note = note;
      await api('/api/regles', { method: 'POST', body: JSON.stringify(r) });
      // Le choix est aussi gardé sur l'opération elle-même : elle reste classée même si
      // le motif est modifié ensuite.
    }
    if (Object.keys(corps).length) await api(`/api/operations/${encodeURIComponent(o.id)}`, { method: 'PATCH', body: JSON.stringify(corps) });
    await charger();
  } catch (e) {
    alert(e.message);
  }
});

// ---------- navigation ----------
document.querySelectorAll('.onglets button').forEach((b) => b.addEventListener('click', () => {
  if (b.dataset.page === 'operations') filtre = 'toutes';
  afficherPage(b.dataset.page);
}));
function afficherPage(nom) {
  document.querySelectorAll('.onglets button').forEach((b) => b.classList.toggle('actif', b.dataset.page === nom));
  for (const p of ['accueil', 'operations', 'projets', 'graphiques', 'reglages']) $(`page-${p}`).hidden = nom !== p;
  scrollTo(0, 0);
  if (nom === 'operations' && donnees?.categories) dessinerOperations(donnees, calcul);
  if (nom === 'reglages') dessinerReglages();
  if (nom === 'graphiques') dessinerGraphiques();
  if (nom === 'projets') dessinerPageProjets();
}

// ---------- réglages ----------
const TYPES = [['enveloppe', 'Dépense courante'], ['fixe', 'Charge fixe'], ['suivi', 'Sans budget'], ['hors', 'Hors budget']];
const enEuros = (c) => (c ? String(Math.round(c / 100)) : '0');
const enCentimesSaisis = (v) => Math.round(Number(String(v).replace(',', '.')) * 100) || 0;

async function dessinerReglages() {
  const d = donnees || { connexions: [], comptes: [], categories: [], regles: [], projets: [] };

  // Règles personnelles
  const perso = (d.regles || []).filter((r) => r.source === 'perso');
  $('liste-regles').innerHTML = perso.map((r) => `<li><div>${echapper(r.motif)}<small>${r.montant ? `${fmt(r.montant)} seulement · ` : ''}${r.categorie ? `→ ${echapper(nomCategorie(d, r.categorie))}` : 'commentaire seulement'}${r.note ? ` · « ${echapper(r.note)} »` : ''}</small></div>
    <button class="action danger" data-regle="${echapper(r.id)}">Supprimer</button></li>`).join('') || '<li class="vide">Aucune règle personnelle pour l’instant.</li>';

  if (!moi?.admin) return;
  if (!$('liste-categories').dataset.modifie) dessinerCategories(d);

  // Comptes
  $('liste-comptes').innerHTML = d.comptes.map((c) => `<li class="compte-reglage" data-compte="${echapper(c.id)}"><div>
      <input class="compte-nom" value="${echapper(c.nom)}" aria-label="Nom du compte" maxlength="40">
      <small>${echapper(c.banque)}${c.iban ? ` · ${echapper(c.iban)}` : ''}${c.solde != null ? ` · solde ${fmt(c.solde)} (type ${echapper(c.solde_type || '?')}${c.solde_date ? `, ${echapper(c.solde_date)}` : ''})` : ''}</small>
      <div class="deux">
        <select class="compte-type" aria-label="Type">${[['courant', 'Compte courant'], ['epargne', 'Épargne']]
          .map(([v, t]) => `<option value="${v}" ${c.type === v ? 'selected' : ''}>${t}</option>`).join('')}</select>
      </div>
      <label class="case"><input type="checkbox" class="compte-masque" ${c.masque ? 'checked' : ''}> Masquer ce compte</label>
    </div></li>`).join('') || '<li class="vide">Aucun compte.</li>';

  // Cartes (repérées par la fin de leur numéro dans les libellés)
  $('liste-cartes').innerHTML = (d.cartes || []).map((c) => `<li><div class="ligne-carte">
      <span>Carte …${echapper(c)}</span>
      <input data-carte="${echapper(c)}" value="${echapper(d.nomsCartes?.[c] || '')}" placeholder="Prénom" maxlength="30" aria-label="Titulaire de la carte …${echapper(c)}">
    </div></li>`).join('') || '<li class="vide">Aucun paiement par carte pour l’instant.</li>';

  // Banque
  $('connexions').innerHTML = d.connexions.map((c) => {
    const n = d.comptes.filter((x) => x.connexion === c.id).length;
    const etat = c.statut === 'active' ? (c.expire ? `accès valable jusqu’au ${dateCourte(c.expire)}` : 'accès actif') : 'accès expiré';
    return `<li><div>${echapper(c.banque)}<small>${n} compte(s) · ${etat}</small></div>
      <span><button class="action" data-renouveler="${echapper(c.id)}">Renouveler</button>
      <button class="action danger" data-retirer="${echapper(c.id)}">Retirer</button></span></li>`;
  }).join('') || '<li class="vide">Aucune banque connectée.</li>';

  try {
    const { appareils } = await api('/api/appareils');
    $('appareils').innerHTML = appareils.map((a) => `<li><div>${echapper(a.nom)}${a.moi ? ' (ce téléphone)' : ''}
      <small>${a.admin ? 'administrateur · ' : ''}vu ${depuis(a.vu)}</small></div>
      ${a.moi ? '' : `<button class="action danger" data-appareil="${echapper(a.id)}">Retirer</button>`}</li>`).join('');
  } catch (e) {
    $('appareils').innerHTML = `<li class="vide">${echapper(e.message)}</li>`;
  }
}

$('liste-regles').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-regle]');
  if (!b) return;
  await api(`/api/regles/${encodeURIComponent(b.dataset.regle)}`, { method: 'DELETE' }).catch((err) => alert(err.message));
  await charger();
});

// Budgets (catégories)
function dessinerCategories(d) {
  delete $('liste-categories').dataset.modifie;
  $('liste-categories').innerHTML = d.categories.map((c) => ligneCategorie(c)).join('');
  majTotalBudget();
}
// Total du budget mensuel pendant la saisie, comparé aux revenus moyens des 3 derniers mois complets.
let revenusMoyens = null;
function majTotalBudget() {
  const lignes = [...document.querySelectorAll('.ligne-categorie')].map((l) => ({
    type: l.querySelector('.cat-type').value, budget: enCentimesSaisis(l.querySelector('.cat-budget').value),
  }));
  const somme = (t) => lignes.filter((l) => l.type === t).reduce((s, l) => s + l.budget, 0);
  const fixes = somme('fixe'), courantes = somme('enveloppe'), total = fixes + courantes;
  let html = `<div class="total-ligne"><span>Total du budget mensuel</span><b>${fmt(total)}</b></div>
    <small>charges fixes ${fmt(fixes)} + dépenses courantes ${fmt(courantes)}</small>`;
  if (revenusMoyens) {
    const reste = revenusMoyens - total;
    html += `<div class="total-ligne"><span>Revenus moyens (3 derniers mois)</span><b>${fmt(revenusMoyens)}</b></div>
      <div class="total-ligne"><span>Reste pour les projets et l’épargne</span><b class="${reste < 0 ? 'negatif' : 'positif'}">${fmtSigne(reste)}</b></div>
      <small>soit ${fmtSigne(reste * 12)} par an, à comparer aux budgets de vos projets</small>`;
  }
  $('total-budget').innerHTML = html;
  if (revenusMoyens === null) {
    revenusMoyens = 0;
    chargerHistorique().then(() => {
      const m0 = moisCourant();
      const prec = [1, 2, 3].map((n) => decalerMois(m0, -n));
      const ops = opsHistorique().filter((o) => o.cat === 'revenus' && !o.projet && !o.epargne && prec.includes(o.date.slice(0, 7)));
      const mois = prec.filter((m) => ops.some((o) => o.date.startsWith(m)));
      revenusMoyens = mois.length ? Math.round(ops.reduce((t, o) => t + o.montant, 0) / mois.length) : 0;
      if (revenusMoyens) majTotalBudget();
    }).catch(() => {});
  }
}
function ligneCategorie(c) {
  return `<div class="ligne-categorie" data-id="${echapper(c.id || '')}">
    <input class="cat-nom" value="${echapper(c.nom)}" aria-label="Nom" maxlength="40" placeholder="Nom">
    <div class="deux">
      <select class="cat-type" aria-label="Type">${TYPES.map(([v, t]) => `<option value="${v}" ${c.type === v ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <label class="cat-budget-l"><input class="cat-budget" type="number" inputmode="decimal" min="0" step="1" value="${enEuros(c.budget)}" aria-label="Budget mensuel en euros"> €/mois</label>
    </div>
    <button type="button" class="action danger cat-suppr">Supprimer</button></div>`;
}
$('liste-categories').addEventListener('input', () => { $('liste-categories').dataset.modifie = '1'; majTotalBudget(); });
$('liste-categories').addEventListener('change', majTotalBudget);
$('liste-categories').addEventListener('click', (e) => {
  if (!e.target.classList.contains('cat-suppr')) return;
  const ligne = e.target.closest('.ligne-categorie');
  if (!confirm(`Supprimer « ${ligne.querySelector('.cat-nom').value} » ? Ses opérations repasseront « à classer ».`)) return;
  ligne.remove();
  $('liste-categories').dataset.modifie = '1';
  majTotalBudget();
});
$('btn-ajout-categorie').addEventListener('click', () => {
  $('liste-categories').insertAdjacentHTML('beforeend', ligneCategorie({ nom: '', type: 'enveloppe', budget: 0 }));
  $('liste-categories').dataset.modifie = '1';
  $('liste-categories').lastElementChild.querySelector('.cat-nom').focus();
});
$('btn-enregistrer-categories').addEventListener('click', async () => {
  const categories = [...document.querySelectorAll('.ligne-categorie')].map((l) => ({
    id: l.dataset.id || undefined,
    nom: l.querySelector('.cat-nom').value.trim(),
    type: l.querySelector('.cat-type').value,
    budget: enCentimesSaisis(l.querySelector('.cat-budget').value),
  })).filter((c) => c.nom);
  try {
    await api('/api/categories', { method: 'PUT', body: JSON.stringify({ categories }) });
    delete $('liste-categories').dataset.modifie;
    await charger();
    dessinerCategories(donnees);
    statut('Budgets enregistrés ✓');
  } catch (e) { alert(e.message); }
});

// Comptes : enregistrement à chaque modification
$('liste-comptes').addEventListener('change', async (e) => {
  const li = e.target.closest('[data-compte]');
  if (!li) return;
  const type = li.querySelector('.compte-type').value;
  try {
    await api(`/api/comptes/${encodeURIComponent(li.dataset.compte)}`, {
      method: 'PATCH',
      body: JSON.stringify({ type, masque: li.querySelector('.compte-masque').checked, nom: li.querySelector('.compte-nom').value }),
    });
    await charger();
  } catch (err) { alert(err.message); }
});

$('liste-cartes').addEventListener('change', async () => {
  const noms = Object.fromEntries([...document.querySelectorAll('[data-carte]')].map((i) => [i.dataset.carte, i.value]));
  try { await api('/api/cartes', { method: 'PUT', body: JSON.stringify({ noms }) }); await charger(); } catch (e) { alert(e.message); }
});

// Banque
$('connexions').addEventListener('click', async (e) => {
  const d = donnees;
  const ren = e.target.closest('[data-renouveler]');
  if (ren) return renouveler(d.connexions.find((c) => c.id === ren.dataset.renouveler));
  const ret = e.target.closest('[data-retirer]');
  if (!ret || !confirm('Retirer cette banque ? Ses comptes et opérations seront effacés de Budget.')) return;
  await api(`/api/connexions/${encodeURIComponent(ret.dataset.retirer)}`, { method: 'DELETE' }).catch((err) => alert(err.message));
  await charger();
});
$('appareils').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-appareil]');
  if (!b || !confirm('Retirer l’accès de ce téléphone ?')) return;
  await api(`/api/appareils/${encodeURIComponent(b.dataset.appareil)}`, { method: 'DELETE' }).catch((err) => alert(err.message));
  dessinerReglages();
});

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
  $('banques').innerHTML = liste.map((b) => `<li><button data-i="${banques.indexOf(b)}">${b.logo ? `<img src="${echapper(b.logo)}" alt="" loading="lazy">` : ''}${echapper(b.nom)}</button></li>`).join('')
    || '<li class="vide">Aucune banque ne correspond.</li>';
}
$('banques').addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) connecter(banques[b.dataset.i]); });
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
    dessinerReglages();
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

// ---------- historique (12 mois) : recherche et graphiques ----------
let historique = null, historiqueEnCours = null;
async function chargerHistorique() {
  if (historique) return historique;
  historiqueEnCours ??= api('/api/historique').then((r) => {
    historique = r;
    return r;
  }).finally(() => { historiqueEnCours = null; });
  return historiqueEnCours;
}
// Ajoute catégorie, projet et commentaire calculés à une opération de l'historique.
function enrichir(o, d) {
  const epargne = typeCompte(d, o.compte) === 'epargne';
  const projet = o.projet ? d.projets.find((p) => p.id === o.projet) : null;
  return { ...o, cat: epargne ? null : categorieDe(o, d), projetNom: projet?.nom || null, epargne, commentaire: noteDe(o) };
}
function opsHistorique() {
  const d = donnees;
  preparerRegles(d);
  return historique.operations.map((o) => enrichir(o, d));
}
function rafraichirVuesHistorique() {
  if (rechercheActive()) rechercher();
  if (!$('page-graphiques').hidden) dessinerGraphiques();
  if (donnees?.mois === moisCourant()) dessinerPrevision();
}

// --- Recherche ---
const rechercheActive = () => $('recherche').value.trim() || filtre === 'carte';
let minuterieRecherche = null;
$('recherche').addEventListener('input', () => { clearTimeout(minuterieRecherche); minuterieRecherche = setTimeout(rechercher, 200); });

async function rechercher() {
  const actif = rechercheActive();
  $('resultats').hidden = !actif;
  $('vue-mois').hidden = !!actif;
  if (!actif) return;
  $('resultats-resume').textContent = 'Recherche dans les 12 derniers mois…';
  try { await chargerHistorique(); } catch (e) { $('resultats-resume').textContent = e.message; return; }
  const d = donnees;
  const q = normaliser($('recherche').value);
  const montantCherche = /^\d+([.,]\d{1,2})?$/.test(q) ? Math.round(Number(q.replace(',', '.')) * 100) : null;
  const res = opsHistorique().filter((o) => {
    if (!passeFiltre(o)) return false;
    if (!q) return true;
    if (montantCherche !== null && Math.abs(o.montant) === montantCherche) return true;
    return normaliser(`${o.libelle} ${o.contrepartie || ''} ${o.commentaire || ''}`).includes(q);
  });
  const total = res.reduce((t, o) => t + o.montant, 0);
  $('resultats-resume').textContent = res.length
    ? `${res.length} opération${res.length > 1 ? 's' : ''}${filtre === 'carte' ? '' : ' sur 12 mois'}${filtre !== 'toutes' ? ` (${nomFiltre(d)})` : ''} · total ${fmtSigne(total)}`
    : 'Aucune opération ne correspond.';
  opsAffichees.clear();
  let html = '', moisCourantRes = null;
  const parMois = {};
  for (const o of res) parMois[o.date.slice(0, 7)] = (parMois[o.date.slice(0, 7)] || 0) + o.montant;
  for (const o of res.slice(0, 400)) {
    const m = o.date.slice(0, 7);
    if (m !== moisCourantRes) { moisCourantRes = m; html += `<h3 class="mois-resultat">${nomMois(m)}<span>${fmtSigne(parMois[m])}</span></h3>`; }
    html += htmlOp(o, d, true);
  }
  if (res.length > 400) html += '<p class="vide">Seules les 400 plus récentes sont affichées : précise la recherche.</p>';
  $('resultats-liste').innerHTML = html;
}
$('resultats-liste').addEventListener('click', (e) => {
  const b = e.target.closest('[data-op]');
  if (b) ouvrirFiche(opsAffichees.get(b.dataset.op));
});

// --- Graphiques ---
const graphs = {};
let catGraph = 'courses';
const couleur = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const eurosCourts = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const fmtCourt = (c) => eurosCourts.format(c / 100);
const moisCourtNom = (m) => new Date(`${m}-15T12:00:00`).toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '');

function listeMois(depuis) {
  const l = [];
  for (let m = depuis; m <= moisCourant(); m = decalerMois(m, 1)) l.push(m);
  return l.slice(-12);
}
function tableau(id, entetes, lignes) {
  $(id).innerHTML = `<table><thead><tr>${entetes.map((e) => `<th>${echapper(e)}</th>`).join('')}</tr></thead><tbody>${
    lignes.map((l) => `<tr>${l.map((c) => `<td>${echapper(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
function optionsCommunes(extra = {}) {
  const encre2 = couleur('--encre-2'), filet = couleur('--filet');
  return {
    responsive: true, maintainAspectRatio: false, animation: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: (c) => `${c.dataset.label} : ${fmt(c.raw * 100)}` } },
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: encre2, maxRotation: 0, autoSkipPadding: 8 }, border: { color: filet } },
      y: { grid: { color: filet }, border: { display: false }, ticks: { color: encre2, callback: (v) => eurosCourts.format(v), maxTicksLimit: 5 } },
    },
    ...extra,
  };
}
function graphique(id, config) {
  graphs[id]?.destroy();
  graphs[id] = new Chart($(id), config);
}

async function dessinerGraphiques() {
  if (!donnees?.categories) return;
  if (typeof Chart === 'undefined') { setTimeout(dessinerGraphiques, 200); return; }
  $('graph-statut').textContent = historique ? '' : 'Chargement de l’historique…';
  try { await chargerHistorique(); } catch (e) { $('graph-statut').textContent = e.message; return; }
  $('graph-statut').textContent = '';
  const d = donnees;
  const ops = opsHistorique().filter((o) => !o.epargne);
  const types = Object.fromEntries(d.categories.map((c) => [c.id, c.type]));
  const moisL = listeMois(historique.depuis);
  const s1 = couleur('--serie-1'), s2 = couleur('--serie-2'), s3 = couleur('--serie-3'), surface = couleur('--surface'), encre2 = couleur('--encre-2');
  const budgetMensuel = d.categories.filter((c) => c.type === 'fixe' || c.type === 'enveloppe').reduce((t, c) => t + c.budget, 0);
  dessinerAtterrissages(moisL);

  // 1. Dépenses par mois : budget du mois / autres dépenses / projets
  const parMois = Object.fromEntries(moisL.map((m) => [m, { budget: 0, autres: 0, projets: 0 }]));
  for (const o of ops) {
    const b = parMois[o.date.slice(0, 7)];
    if (!b) continue;
    if (o.projet) { b.projets -= o.montant; continue; }
    const t = o.cat ? types[o.cat] : 'aclasser';
    if (t === 'hors') continue;
    if (t === 'suivi') b.autres -= o.montant;
    else b.budget -= o.montant;
  }
  const series = [['Budget du mois', 'budget', s1], ['Autres dépenses', 'autres', s2], ['Projets', 'projets', s3]];
  $('legende-mois').innerHTML = series.map(([n, , c]) => `<span><i style="background:${c}"></i>${n}</span>`).join('')
    + '<span><i class="trait"></i>Budget mensuel</span>';
  graphique('g-mois', {
    type: 'bar',
    data: {
      labels: moisL.map(moisCourtNom),
      datasets: [
        ...series.map(([n, k, c]) => ({ label: n, data: moisL.map((m) => Math.max(parMois[m][k], 0) / 100), backgroundColor: c,
          borderColor: surface, borderWidth: { top: 2 }, borderSkipped: 'bottom', borderRadius: 4, maxBarThickness: 22, stack: 's' })),
        { type: 'line', label: 'Budget mensuel', data: moisL.map(() => budgetMensuel / 100), borderColor: encre2, borderWidth: 1.5,
          borderDash: [5, 4], pointRadius: 0, pointHitRadius: 0 },
      ],
    },
    options: optionsCommunes({ scales: { ...optionsCommunes().scales, x: { ...optionsCommunes().scales.x, stacked: true }, y: { ...optionsCommunes().scales.y, stacked: true } } }),
  });
  tableau('t-mois', ['Mois', 'Budget du mois', 'Autres', 'Projets', 'Total'],
    moisL.map((m) => { const b = parMois[m]; return [nomMois(m), fmt(b.budget), fmt(b.autres), fmt(b.projets), fmt(b.budget + b.autres + b.projets)]; }));

  // 2. Une catégorie dans le temps
  const choix = d.categories.filter((c) => c.type !== 'hors');
  if (!choix.some((c) => c.id === catGraph)) catGraph = choix[0]?.id;
  $('choix-cat-graph').innerHTML = choix.map((c) => `<button type="button" role="radio" aria-checked="${c.id === catGraph}" data-g="${echapper(c.id)}">${echapper(c.nom)}</button>`).join('');
  const cat = d.categories.find((c) => c.id === catGraph);
  const valeurs = moisL.map((m) => ops.filter((o) => !o.projet && o.cat === catGraph && o.date.startsWith(m)).reduce((t, o) => t - o.montant, 0));
  graphique('g-cat', {
    type: 'bar',
    data: {
      labels: moisL.map(moisCourtNom),
      datasets: [
        { label: cat?.nom || '', data: valeurs.map((v) => v / 100), backgroundColor: s1, borderRadius: 4, borderSkipped: 'bottom', maxBarThickness: 22 },
        ...(cat?.budget ? [{ type: 'line', label: 'Budget', data: moisL.map(() => cat.budget / 100), borderColor: encre2, borderWidth: 1.5, borderDash: [5, 4], pointRadius: 0, pointHitRadius: 0 }] : []),
      ],
    },
    options: optionsCommunes(),
  });
  const moyenne = valeurs.slice(0, -1).filter((v) => v).reduce((t, v, _, a) => t + v / a.length, 0);
  $('g-cat').setAttribute('aria-label', `${cat?.nom} par mois, moyenne ${fmt(moyenne)}`);
  tableau('t-cat', ['Mois', cat?.nom || ''], moisL.map((m, i) => [nomMois(m), fmt(valeurs[i])]).concat([['Moyenne (mois complets)', fmt(moyenne)]]));

  // 3. Répartition du mois affiché (barres horizontales triées)
  const moisR = donnees.mois;
  $('titre-repartition').textContent = `Répartition : ${nomMois(moisR)}`;
  const rep = {};
  for (const o of ops) {
    if (!o.date.startsWith(moisR)) continue;
    const cle = o.projet ? `Projet · ${o.projetNom}` : o.cat ? (types[o.cat] === 'hors' ? null : nomCategorie(d, o.cat)) : 'À classer';
    if (cle) rep[cle] = (rep[cle] || 0) - o.montant;
  }
  const lignesRep = Object.entries(rep).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  $('cadre-repartition').style.height = `${Math.max(120, lignesRep.length * 34 + 30)}px`;
  graphique('g-repartition', {
    type: 'bar',
    data: { labels: lignesRep.map(([n]) => n), datasets: [{ label: 'Dépensé', data: lignesRep.map(([, v]) => v / 100), backgroundColor: s1, borderRadius: 4, borderSkipped: 'left', maxBarThickness: 18 }] },
    options: (() => { const o = optionsCommunes({ indexAxis: 'y' }); o.interaction = { mode: 'nearest', axis: 'y', intersect: false };
      o.scales = { x: { ...o.scales.y, grid: { color: couleur('--filet') } }, y: { grid: { display: false }, border: { display: false }, ticks: { color: couleur('--encre'), autoSkip: false,
        callback(v) { const n = this.getLabelForValue(v); return n.length > 20 ? `${n.slice(0, 19)}…` : n; } } } };
      o.plugins.tooltip.callbacks.title = (items) => items[0].label; return o; })(),
  });
  tableau('t-repartition', ['Catégorie', 'Dépensé'], lignesRep.map(([n, v]) => [n, fmt(v)]));

  // 4. Solde du compte, reconstitué à rebours depuis le solde actuel
  const courants = d.comptes.filter((c) => !c.masque && c.type !== 'epargne');
  let solde = courants.reduce((t, c) => t + (c.solde || 0), 0);
  const ids = new Set(courants.map((c) => c.id));
  const mouvements = {};
  for (const o of historique.operations) {
    if (!ids.has(o.compte) || o.statut !== 'BOOK') continue;
    mouvements[o.date_compta] = (mouvements[o.date_compta] || 0) + o.montant;
  }
  const jours = [];
  const fin = new Date(); const debut = new Date(`${moisL[0]}-01T12:00:00`);
  for (let j = new Date(fin); j >= debut; j.setDate(j.getDate() - 1)) {
    const iso = isoLocal(j);
    jours.push([iso, solde]);
    solde -= mouvements[iso] || 0;   // solde de la veille au soir
  }
  jours.reverse();
  graphique('g-solde', {
    type: 'line',
    data: { labels: jours.map(([j]) => j), datasets: [{ label: 'Solde', data: jours.map(([, v]) => v / 100), borderColor: s1, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, tension: 0, fill: false }] },
    options: (() => {
      const o = optionsCommunes();
      // Un mois sur deux sur un écran de téléphone, pour que les noms ne se chevauchent pas.
      const pas = $('g-solde').parentElement.clientWidth < 520 ? 2 : 1;
      const premiers = jours.map(([j]) => j).filter((j) => j.endsWith('-01'));
      o.scales.x.ticks.callback = function (v) {
        const j = this.getLabelForValue(v);
        const i = premiers.indexOf(j);
        return i >= 0 && (premiers.length - 1 - i) % pas === 0 ? moisCourtNom(j.slice(0, 7)) : null;
      };
      o.scales.x.ticks.autoSkip = false;
      o.scales.y.grid.color = (c) => (c.tick.value === 0 ? couleur('--encre-2') : couleur('--filet'));
      o.plugins.tooltip.callbacks.title = (items) => new Date(`${items[0].label}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
      return o;
    })(),
  });
  tableau('t-solde', ['Fin de mois', 'Solde'], moisL.map((m) => { const dernier = jours.filter(([j]) => j.startsWith(m)).pop(); return [nomMois(m), dernier ? fmt(dernier[1]) : '–']; }));
}
$('choix-cat-graph').addEventListener('click', (e) => {
  const b = e.target.closest('[data-g]');
  if (!b) return;
  catGraph = b.dataset.g;
  dessinerGraphiques();
});

// ---------- prévision du solde ----------
const MOIS_EN_LETTRES = /\b(JANVIER|FEVRIER|MARS|AVRIL|MAI|JUIN|JUILLET|AOUT|SEPTEMBRE|OCTOBRE|NOVEMBRE|DECEMBRE|JANV|FEVR?|AVR|JUIL|SEPT?|OCT|NOV|DEC)\b/g;
// Clé d'une opération récurrente : le commerçant ou l'émetteur, sans dates ni mois (« SALAIRE NOVEMBRE » = « SALAIRE OCTOBRE »).
function cleRecurrence(o) {
  const base = normaliser(o.contrepartie || o.libelle)
    .replace(/\b(PAIEMENT|CB|CARTE|PRLV|SEPA|VIR|VIREMENT|INST|RECU|EMIS|DE|DU|LE|LA|M|MME|MR)\b/g, ' ')
    .replace(MOIS_EN_LETTRES, ' ')
    .replace(/\bX?\d[\d/.:-]*\b/g, ' ').replace(/[^A-Z0-9&' ]/g, ' ').replace(/\s+/g, ' ').trim();
  return `${o.montant > 0 ? '+' : '-'}${base.split(' ').slice(0, 3).join(' ')}`;
}
const mediane = (l) => { const t = [...l].sort((a, b) => a - b); const n = t.length; return n ? (n % 2 ? t[(n - 1) / 2] : (t[n / 2 - 1] + t[n / 2]) / 2) : 0; };
const dateDuMois = (m, jour) => `${m}-${String(Math.min(jour, joursDansMois(m))).padStart(2, '0')}`;
const lendemain = (iso) => { const j = new Date(`${iso}T12:00:00`); j.setDate(j.getDate() + 1); return isoLocal(j); };

// Opérations qui reviennent au moins 2 des 3 derniers mois (hors cartes), avec leur jour et montant habituels.
function detecterRecurrences(ops, d) {
  const m0 = moisCourant();
  const prec = [1, 2, 3].map((n) => decalerMois(m0, -n));
  const courants = new Set(d.comptes.filter((c) => !c.masque && c.type !== 'epargne').map((c) => c.id));
  const groupes = {};
  for (const o of ops) {
    if (!courants.has(o.compte) || o.carte || o.statut !== 'BOOK' || Math.abs(o.montant) < 500 || o.cat === 'differe') continue;
    const m = o.date_compta.slice(0, 7);
    if (m !== m0 && !prec.includes(m)) continue;
    const k = cleRecurrence(o);
    const g = (groupes[k] ??= { cle: k, libelle: o.libelle, mois: {}, jours: [], ceMois: 0 });
    if (m === m0) { g.ceMois += o.montant; continue; }
    g.mois[m] = (g.mois[m] || 0) + o.montant;
    g.jours.push(Number(o.date_compta.slice(8, 10)));
    g.libelle = o.libelle;
    g.cat = o.projet ? null : o.cat;
    g.projet = o.projet || null;
  }
  return Object.values(groupes)
    .filter((g) => Object.keys(g.mois).length >= 2 && (g.mois[prec[0]] || g.mois[prec[1]]))
    .map((g) => ({ ...g, montant: Math.round(mediane(Object.values(g.mois))), jour: Math.round(mediane(g.jours)) }));
}

// Solde de fin de journée, reconstitué à rebours depuis le solde actuel.
function soldesPasses(depuisIso) {
  const d = donnees;
  const courants = d.comptes.filter((c) => !c.masque && c.type !== 'epargne');
  const ids = new Set(courants.map((c) => c.id));
  let solde = courants.reduce((t, c) => t + (c.solde || 0), 0);
  const mouvements = {};
  for (const o of historique.operations) {
    if (ids.has(o.compte) && o.statut === 'BOOK') mouvements[o.date_compta] = (mouvements[o.date_compta] || 0) + o.montant;
  }
  const jours = [];
  for (let j = new Date(); isoLocal(j) >= depuisIso; j.setDate(j.getDate() - 1)) {
    const iso = isoLocal(j);
    jours.push([iso, solde]);
    solde -= mouvements[iso] || 0;
  }
  return jours.reverse();
}

let prevision = null;
function calculerPrevision() {
  const d = donnees;
  const ops = opsHistorique();
  const auj = aujourdhui();
  const m0 = moisCourant(), m1 = decalerMois(m0, 1);
  // Jusqu'au 10 du mois suivant, et au moins 6 semaines (pour avancer semaine par semaine).
  const dans6 = (() => { const j = new Date(`${auj}T12:00:00`); j.setDate(j.getDate() + 42); return isoLocal(j); })();
  const horizon = dans6 > `${m1}-10` ? dans6 : `${m1}-10`;
  const nb = joursDansMois(m0);
  const evenements = [];
  const ignores = new Set(d.prevision?.ignores || []);

  // 1. Opérations récurrentes (salaires, prêt, énergie, école…)
  const modifs = d.prevision?.modifs || {};
  // Récurrences déclarées à la main : elles remplacent la détection automatique pour le même libellé.
  const perso = d.prevision?.recurrentes || [];
  const basesPerso = new Set(perso.map((r) => r.base));
  const courantsIds = new Set(d.comptes.filter((c) => !c.masque && c.type !== 'epargne').map((c) => c.id));
  const recurrences = detecterRecurrences(ops, d).filter((r) => !basesPerso.has(r.cle));
  for (const p of perso) {
    const tolerance = Math.max(100, Math.abs(p.montant) * 0.05);
    const ceMois = ops.filter((o) => courantsIds.has(o.compte) && !o.carte && (o.date_compta || o.date).startsWith(m0)
      && cleRecurrence(o) === p.base && Math.abs(o.montant - p.montant) <= tolerance).reduce((t, o) => t + o.montant, 0);
    recurrences.push({ cle: `p:${p.id}`, libelle: p.libelle, montant: p.montant, jour: p.jour, ceMois, perso: p,
      cat: categorieDe({ libelle: p.libelle, contrepartie: null, montant: p.montant, categorie: null }, d) });
  }
  for (const detecte of recurrences) {
    if (ignores.has(detecte.cle)) continue;
    const m = modifs[detecte.cle];
    const r = { ...detecte, ...(m || {}), detecte, modifie: !!m };
    if (!r.ceMois) {
      let date = dateDuMois(m0, r.jour);
      const retard = date <= auj;
      if (retard) date = lendemain(auj);
      evenements.push({ date, libelle: r.libelle, montant: r.montant, cle: r.cle, retard, recurrence: r, cat: r.cat });
    }
    for (const m of [m1, decalerMois(m0, 2)]) {
      const date = dateDuMois(m, r.jour);
      if (date <= horizon) evenements.push({ date, libelle: r.libelle, montant: r.montant, cle: r.cle, recurrence: r, cat: r.cat });
    }
  }

  // 2. Cartes à débit différé. Le relevé ne suit pas le mois civil : il s'arrête à une date fixe
  //    (l'« arrêté ») et tout ce qui est acheté ensuite part au prélèvement suivant.
  //    On déduit de l'historique le jour du prélèvement et le jour de l'arrêté.
  const cartesDebitees = ops.filter((o) => o.carte && o.statut === 'BOOK' && o.date_compta && o.date_compta !== o.date && !o.epargne);
  const jourCarte = cartesDebitees.length ? Math.round(mediane(cartesDebitees.map((o) => Number(o.date_compta.slice(8, 10))))) : 5;
  let jourArrete = null;   // null = fin du mois
  const prelevements = [...new Set(cartesDebitees.map((o) => o.date_compta))].filter((p) => p <= auj).sort();
  if (prelevements.length) {
    // L'achat le plus tardif couvert par le dernier prélèvement donne le jour de l'arrêté
    // (à un ou deux jours près ; tout près de la fin du mois, on retient la fin du mois).
    const dernier = prelevements[prelevements.length - 1];
    const d = cartesDebitees.filter((o) => o.date_compta === dernier).reduce((m, o) => (o.date > m ? o.date : m), '');
    const j = Number(d.slice(8, 10));
    jourArrete = j >= joursDansMois(d.slice(0, 7)) - 1 ? null : j;
  }
  const arreteAvant = (datePrelevement) => {   // arrêté du relevé prélevé à cette date : le mois précédent
    const m = decalerMois(datePrelevement.slice(0, 7), -1);
    return dateDuMois(m, jourArrete || 31);
  };
  // Rythme des cartes : moyenne par jour sur les 90 derniers jours (ou depuis le début de l'historique).
  const debut90 = (() => { const j = new Date(`${auj}T12:00:00`); j.setDate(j.getDate() - 90); return isoLocal(j); })();
  const achats90 = ops.filter((o) => o.carte && !o.epargne && o.montant < 0 && o.date > debut90 && o.date <= auj);
  const premierAchat = achats90.reduce((m, o) => (o.date < m ? o.date : m), auj);
  const joursObserves = Math.max(30, Math.round((Date.parse(auj) - Date.parse(premierAchat)) / 86400000));
  const parJour = achats90.reduce((t, o) => t + o.montant, 0) / joursObserves;
  const aDebiter = ops.filter((o) => o.statut === 'AVNR' && !o.epargne);
  const nbJoursEntre = (a, b) => Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 86400000));
  let datePrel = dateDuMois(m0, jourCarte) > auj ? dateDuMois(m0, jourCarte) : dateDuMois(m1, jourCarte);
  let arretePrecedent = null;
  for (let k = 0; k < 3 && datePrel <= horizon; k++) {
    const arrete = arreteAvant(datePrel);
    const achats = aDebiter.filter((o) => o.date <= arrete && (!arretePrecedent || o.date > arretePrecedent));
    const deja = achats.reduce((t, o) => t + o.montant, 0);
    const restants = nbJoursEntre(arretePrecedent && arretePrecedent > auj ? arretePrecedent : auj, arrete);
    const estime = Math.round(parJour * restants);
    if (deja || estime) {
      const fin = new Date(`${arrete}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
      evenements.push({
        date: datePrel, carte: true, montant: deja + estime,
        libelle: `Prélèvement des cartes (achats jusqu’au ${fin}${estime ? `, dont ${fmt(-estime)} estimés` : ''})`,
      });
    }
    arretePrecedent = arrete;
    const suivant = decalerMois(datePrel.slice(0, 7), 1);
    datePrel = dateDuMois(suivant, jourCarte);
  }

  // 3. Opérations prévues à la main
  for (const a of d.prevision?.ajouts || []) if (a.date > auj && a.date <= horizon) evenements.push({ ...a, ajout: true });

  evenements.sort((a, b) => a.date.localeCompare(b.date));
  // Courbe : réel du 1er à aujourd'hui, puis prévu jusqu'à l'horizon.
  const reel = soldesPasses(`${m0}-01`);
  let solde = reel.length ? reel[reel.length - 1][1] : 0;
  const prevu = [[auj, solde]];
  let bas = { solde, date: auj }, fin = null;
  for (let j = lendemain(auj); j <= horizon; j = lendemain(j)) {
    for (const e of evenements) if (e.date === j) solde += e.montant;
    prevu.push([j, solde]);
    if (solde < bas.solde) bas = { solde, date: j };
    if (j === `${m0}-${String(nb).padStart(2, '0')}`) fin = solde;
  }
  if (fin === null) fin = prevu[prevu.length - 1][1];
  return { reel, prevu, evenements, bas, fin, horizon };
}

async function dessinerPrevision() {
  if (!donnees?.comptes?.length) return;
  try { await chargerHistorique(); } catch { return; }
  if (typeof Chart === 'undefined') { setTimeout(dessinerPrevision, 200); return; }
  prevision = calculerPrevision();
  const p = prevision;
  $('prev-fin').textContent = fmt(p.fin);
  $('prev-fin').classList.toggle('negatif', p.fin < 0);
  $('prev-bas').textContent = fmt(p.bas.solde);
  $('prev-bas').classList.toggle('negatif', p.bas.solde < 0);
  $('prev-bas-date').textContent = `le ${new Date(`${p.bas.date}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}`;
  const labels = [...p.reel.map(([j]) => j), ...p.prevu.slice(1).map(([j]) => j)];
  const nReel = p.reel.length;
  const s1 = couleur('--serie-1');
  const o = optionsCommunes();
  o.scales.x.ticks.callback = function (v) { const j = this.getLabelForValue(v); return j.endsWith('-01') || j.endsWith('-15') ? `${Number(j.slice(8))} ${moisCourtNom(j.slice(0, 7))}` : null; };
  o.scales.x.ticks.autoSkip = false;
  o.scales.y.grid.color = (c) => (c.tick.value === 0 ? couleur('--encre-2') : couleur('--filet'));
  o.plugins.tooltip.callbacks.title = (items) => new Date(`${items[0].label}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'long' });
  o.plugins.tooltip.filter = (item) => item.raw !== null && !(item.datasetIndex === 1 && item.dataIndex === nReel - 1);
  graphique('g-prevision', {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Solde réel', data: labels.map((_, i) => (i < nReel ? p.reel[i][1] / 100 : null)), borderColor: s1, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, tension: 0 },
        { label: 'Prévu', data: labels.map((_, i) => (i >= nReel - 1 ? p.prevu[i - nReel + 1][1] / 100 : null)), borderColor: s1, borderDash: [5, 4], borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, tension: 0 },
      ],
    },
    options: o,
  });
  majCurseur();
  majLigneAtterrissage();
  $('a-venir-titre').textContent = `À venir d’ici le ${Number(p.horizon.slice(8))} ${nomMois(p.horizon.slice(0, 7)).split(' ')[0]} (${p.evenements.length})`;
  $('a-venir').innerHTML = p.evenements.map((e, i) => `<li><button data-prevu="${i}">
      <span class="quand">${new Date(`${e.date}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</span>
      <span class="quoi">${echapper(e.libelle)}${e.recurrence?.modifie ? ' <small>(modifiée)</small>' : ''}${e.retard ? ' <small>(habituellement plus tôt)</small>' : ''}</span>
      <b class="${e.montant > 0 ? 'positif' : ''}">${fmtSigne(e.montant)}</b></button></li>`).join('') || '<li class="vide">Rien de prévu.</li>';
}

async function enregistrerPrevision(modif) {
  const pr = { ignores: [...(donnees.prevision?.ignores || [])], ajouts: [...(donnees.prevision?.ajouts || [])], modifs: { ...(donnees.prevision?.modifs || {}) },
    recurrentes: [...(donnees.prevision?.recurrentes || [])] };
  modif(pr);
  try { await api('/api/prevision', { method: 'PUT', body: JSON.stringify(pr) }); await charger({ garderHistorique: true }); } catch (e) { alert(e.message); }
}
$('a-venir').addEventListener('click', (e) => {
  const b = e.target.closest('[data-prevu]');
  if (!b || !prevision) return;
  const ev = prevision.evenements[b.dataset.prevu];
  if (ev.carte) { alert('Le prélèvement des cartes est calculé à partir des paiements à débiter : il ne peut pas être ignoré.'); return; }
  if (ev.ajout) {
    if (confirm(`Supprimer « ${ev.libelle} » des opérations prévues ?`)) enregistrerPrevision((pr) => { pr.ajouts = pr.ajouts.filter((a) => a.id !== ev.id); });
  } else if (ev.recurrence) {
    ouvrirRecurrence(ev.recurrence);
  }
});

let recurrenceOuverte = null;
function ouvrirRecurrence(r) {
  recurrenceOuverte = r;
  $('rec-libelle').textContent = r.libelle;
  $('rec-habitude').textContent = `${r.perso ? 'Déclarée' : 'Détectée'} : ${fmtSigne(r.detecte.montant)} vers le ${r.detecte.jour} du mois${r.detecte.montant > 0 ? ' (rentrée d’argent)' : ''}.`;
  $('rec-montant').value = (Math.abs(r.montant) / 100).toFixed(2);
  $('rec-jour').value = r.jour;
  $('rec-retablir').hidden = !r.modifie;
  $('dlg-recurrente').showModal();
}
$('dlg-recurrente').addEventListener('close', () => {
  const r = recurrenceOuverte;
  const choix = $('dlg-recurrente').returnValue;
  if (!r || choix === 'annuler' || !choix) return;
  if (choix === 'ignorer') {
    if (confirm(`Ne plus prévoir « ${r.libelle} » ?`)) {
      enregistrerPrevision((pr) => {
        if (r.perso) pr.recurrentes = pr.recurrentes.filter((x) => x.id !== r.perso.id); else pr.ignores.push(r.cle);
        delete pr.modifs[r.cle];
      });
    }
  } else if (choix === 'retablir') {
    enregistrerPrevision((pr) => { delete pr.modifs[r.cle]; });
  } else {
    const signe = r.detecte.montant > 0 ? 1 : -1;
    const montant = signe * Math.abs(enCentimesSaisis($('rec-montant').value));
    const jour = Math.min(31, Math.max(1, Math.round(Number($('rec-jour').value) || r.jour)));
    enregistrerPrevision((pr) => { pr.modifs[r.cle] = { montant, jour }; });
  }
});
let sensPrevu = -1;
$('btn-ajout-prevu').addEventListener('click', () => {
  $('form-prevu').reset();
  sensPrevu = -1;
  document.querySelectorAll('[data-sens]').forEach((x) => { x.classList.toggle('actif', x.dataset.sens === '-1'); x.setAttribute('aria-checked', String(x.dataset.sens === '-1')); });
  $('prevu-date').min = lendemain(aujourdhui());
  $('prevu-date').value = lendemain(aujourdhui());
  $('dlg-prevu').showModal();
});
document.querySelectorAll('[data-sens]').forEach((b) => b.addEventListener('click', () => {
  sensPrevu = Number(b.dataset.sens);
  document.querySelectorAll('[data-sens]').forEach((x) => { x.classList.toggle('actif', x === b); x.setAttribute('aria-checked', String(x === b)); });
}));
$('dlg-prevu').addEventListener('close', () => {
  if ($('dlg-prevu').returnValue !== 'ok') return;
  const montant = enCentimesSaisis($('prevu-montant').value) * sensPrevu;
  const a = { id: crypto.randomUUID?.() || String(Date.now()), date: $('prevu-date').value, libelle: $('prevu-libelle').value.trim(), montant };
  enregistrerPrevision((pr) => { pr.ajouts.push(a); });
});

// ---------- analyse avec Claude ----------
// Résumé texte des comptes, sans IBAN ni noms, à coller dans l'app Claude.
async function texteAnalyse() {
  await chargerHistorique();
  const d = donnees;
  const nbMois = Number($('analyse-periode').value);
  const questions = [...document.querySelectorAll('.analyse-q:checked')].map((c) => c.value);
  const m0 = moisCourant();
  const moisL = Array.from({ length: nbMois }, (_, i) => decalerMois(m0, i - nbMois + 1));
  const ops = opsHistorique().filter((o) => !o.epargne && o.date >= `${moisL[0]}-01`);
  const types = Object.fromEntries(d.categories.map((c) => [c.id, c.type]));
  const e = (c) => (c / 100).toFixed(2).replace('.', ',');

  // Anonymisation : noms des titulaires (tirés des noms de comptes et des cartes) remplacés.
  const mots = new Set();
  for (const c of d.comptes) for (const m of normaliser(c.nom).split(/[^A-Z]+/)) if (m.length >= 3 && !['MME', 'MLLE', 'COMPTE', 'JOINT', 'LIVRET'].includes(m)) mots.add(m);
  for (const n of Object.values(d.nomsCartes || {})) for (const m of normaliser(n).split(/[^A-Z]+/)) if (m.length >= 3) mots.add(m);
  const anonyme = (t) => { let x = normaliser(t); for (const m of mots) x = x.replace(new RegExp(`\\b${m}\\b`, 'g'), '[NOM]'); return x; };
  const cartes = Object.keys(d.nomsCartes || {}).concat(d.cartes || []).filter((v, i, a) => a.indexOf(v) === i).sort();
  const carteAnonyme = (c) => (c ? `carte ${String.fromCharCode(65 + Math.max(cartes.indexOf(c), 0))}` : '');
  const nomCat = (o) => (o.projet ? `Projet : ${o.projetNom}` : o.cat ? nomCategorie(d, o.cat) : 'À classer');

  const L = [];
  L.push('# Budget familial : données pour analyse', '');
  L.push('Contexte : un foyer (deux adultes), comptes à la Caisse d’Épargne. Les deux cartes bancaires sont à débit différé : les achats carte d’un mois sont prélevés un par un vers le 5 du mois suivant. Les opérations sont datées du jour de l’achat. Montants en euros, négatifs = dépenses.');
  L.push(`Période : ${nomMois(moisL[0])} à ${nomMois(m0)}. Le mois en cours est incomplet (jour ${Number(aujourdhui().slice(8))} sur ${joursDansMois(m0)}).`, '');
  L.push('## Budgets mensuels', 'Catégorie | Type | Budget mensuel');
  const libType = { fixe: 'charge fixe', enveloppe: 'dépense courante', suivi: 'sans budget', hors: 'hors budget (revenus, virements…)' };
  for (const c of d.categories) L.push(`${c.nom} | ${libType[c.type]} | ${c.budget ? e(c.budget) : '-'}`);
  if (d.projets.length) {
    L.push('', '## Projets (budget sur une période, hors budgets du mois)', 'Projet | Budget | Période | Dépensé');
    for (const p of d.projets.filter((x) => !x.archive)) L.push(`${p.nom} | ${e(p.budget)} | ${p.debut} à ${p.fin} | ${e(p.depense)}`);
  }
  L.push('', '## Dépenses par catégorie et par mois');
  const lignesCat = [...d.categories.map((c) => c.nom), 'À classer', 'Projets'];
  L.push(`Catégorie | ${moisL.join(' | ')}`);
  for (const nom of lignesCat) {
    const v = moisL.map((m) => ops.filter((o) => o.date.startsWith(m) && (nom === 'Projets' ? o.projet : !o.projet && nomCat(o) === nom)).reduce((t, o) => t + o.montant, 0));
    if (v.some((x) => x)) L.push(`${nom} | ${v.map(e).join(' | ')}`);
  }
  if (prevision) {
    L.push('', '## Prévision du solde des comptes courants');
    L.push(`Solde aujourd’hui : ${e(prevision.reel[prevision.reel.length - 1]?.[1] || 0)}. Fin du mois prévue : ${e(prevision.fin)}. Point bas prévu : ${e(prevision.bas.solde)} le ${prevision.bas.date}.`);
    L.push('Opérations attendues :');
    for (const ev of prevision.evenements) L.push(`- ${ev.date} | ${anonyme(ev.libelle)} | ${e(ev.montant)}`);
  }
  if (nbMois <= 3) {
    L.push('', '## Opérations', 'Date | Libellé | Montant | Catégorie | Commentaire | Carte');
    for (const o of ops) {
      if (types[o.cat] === 'hors' && o.cat !== 'revenus') continue;
      L.push(`${o.date} | ${anonyme(o.libelle)} | ${e(o.montant)} | ${nomCat(o)} | ${o.commentaire ? anonyme(o.commentaire) : ''} | ${carteAnonyme(o.carte)}`);
    }
  } else {
    // 12 mois : principaux commerçants et grosses dépenses, pour rester lisible.
    const parCle = {};
    for (const o of ops) {
      if (o.montant >= 0 || (o.cat && types[o.cat] === 'hors')) continue;
      const k = cleRecurrence(o).slice(1) || anonyme(o.libelle);
      const x = (parCle[k] ??= { total: 0, n: 0, cat: nomCat(o) });
      x.total -= o.montant; x.n++;
    }
    L.push('', '## Principaux commerçants et prélèvements (12 mois)', 'Libellé | Total | Nombre | Catégorie');
    for (const [k, x] of Object.entries(parCle).sort((a, b) => b[1].total - a[1].total).slice(0, 60)) L.push(`${anonyme(k)} | ${e(x.total)} | ${x.n} | ${x.cat}`);
    L.push('', '## Dépenses de plus de 200 €', 'Date | Libellé | Montant | Catégorie | Commentaire');
    for (const o of ops.filter((x) => x.montant <= -20000 && !(x.cat && types[x.cat] === 'hors'))) L.push(`${o.date} | ${anonyme(o.libelle)} | ${e(o.montant)} | ${nomCat(o)} | ${o.commentaire ? anonyme(o.commentaire) : ''}`);
  }
  const Q = {
    evitables: 'Repère les dépenses dont on aurait pu se passer (achats impulsifs, petits montants répétés, livraisons, doublons), avec les opérations concernées et l’économie possible par mois.',
    abonnements: 'Liste les abonnements, frais bancaires et prélèvements réguliers, leur coût annuel, et ceux qui méritent d’être renégociés ou résiliés.',
    budgets: 'Compare les dépenses réelles aux budgets et propose des montants plus réalistes, catégorie par catégorie.',
    tresorerie: 'Explique comment éviter le découvert compte tenu du débit différé des cartes et de la prévision (dates, montants, réserve à garder).',
    projets: 'Dis-moi si les projets sont finançables avec ce rythme de dépenses, et comment les provisionner chaque mois.',
  };
  L.push('', '## Ce que j’attends de toi');
  for (const q of questions) L.push(`- ${Q[q]}`);
  L.push('- Réponds en français, de façon concrète et chiffrée, en citant les opérations. Termine par les 3 actions les plus utiles. Pose-moi des questions si une donnée n’est pas claire.');
  return L.join('\n');
}
let texteAnalyseCache = '';
async function preparerAnalyse() {
  $('analyse-taille').textContent = 'Préparation…';
  try {
    texteAnalyseCache = await texteAnalyse();
    $('analyse-taille').textContent = `Texte prêt : ${texteAnalyseCache.split('\n').length} lignes, ${Math.round(texteAnalyseCache.length / 1000)} 000 caractères environ.`;
  } catch (e) { $('analyse-taille').textContent = e.message; }
}
$('btn-analyse').addEventListener('click', () => { $('dlg-analyse').showModal(); preparerAnalyse(); });
$('analyse-periode').addEventListener('change', preparerAnalyse);
document.querySelectorAll('.analyse-q').forEach((c) => c.addEventListener('change', preparerAnalyse));
$('btn-analyse-copier').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(texteAnalyseCache); $('analyse-taille').textContent = 'Copié ✓ Colle-le dans une nouvelle conversation Claude.'; }
  catch { $('analyse-taille').textContent = 'Copie impossible sur cet appareil : utilise « Envoyer à Claude ».'; }
});
$('btn-analyse-partager').addEventListener('click', async () => {
  if (navigator.share) {
    try { await navigator.share({ text: texteAnalyseCache }); } catch { /* partage annulé */ }
  } else {
    $('btn-analyse-copier').click();
    window.open('https://claude.ai/new', '_blank');
  }
});

// ---------- déclarer une opération récurrente depuis sa fiche ----------
function recurrentePersoDe(o) {
  const base = cleRecurrence(o);
  return (donnees.prevision?.recurrentes || []).find((r) => r.base === base && Math.abs(r.montant - o.montant) <= Math.max(100, Math.abs(r.montant) * 0.05));
}
function majFicheRecurrente() {
  const o = ficheOp;
  const possible = o && !o.carte && !o.epargne && o.statut !== 'AVNR';
  $('fiche-prevision').hidden = !possible;
  if (!possible) return;
  const r = recurrentePersoDe(o);
  const jour = Number(o.date.slice(8, 10));
  $('btn-fiche-recurrente').textContent = r ? 'Ne plus prévoir chaque mois' : `Prévoir chaque mois, le ${jour}`;
  $('fiche-recurrente-etat').textContent = r ? `Prévue le ${r.jour} de chaque mois (${fmtSigne(r.montant)}). Modifiable depuis la prévision.` : '';
}
$('btn-fiche-recurrente').addEventListener('click', async () => {
  const o = ficheOp;
  if (!o) return;
  const r = recurrentePersoDe(o);
  await enregistrerPrevision((pr) => {
    if (r) pr.recurrentes = pr.recurrentes.filter((x) => x.id !== r.id);
    else pr.recurrentes.push({ id: crypto.randomUUID?.() || String(Date.now()), base: cleRecurrence(o), libelle: o.libelle, montant: o.montant, jour: Number(o.date.slice(8, 10)) });
  });
  majFicheRecurrente();
});

// ---------- curseur dans le temps : avancer semaine par semaine ----------
// Montre l'état prévu à une date future : solde, enveloppes au rythme actuel, charges fixes passées.
let semaines = 0;
const plusJours = (iso, n) => { const j = new Date(`${iso}T12:00:00`); j.setDate(j.getDate() + n); return isoLocal(j); };
const dateLongue = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const dateCourteJ = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

function projeter(D) {
  const d = donnees, k = calcul, p = prevision;
  const auj = aujourdhui(), m0 = moisCourant(), mD = D.slice(0, 7);
  const ecoules = Math.max(k.jour, 1);
  const joursAvant = Math.round((Date.parse(D) - Date.parse(auj)) / 86400000);
  const jourD = Number(D.slice(8, 10)), nbD = joursDansMois(mD);
  // Rythme de chaque enveloppe : mélange du rythme du mois en cours et de la moyenne des
  // 3 derniers mois complets. Le mois en cours pèse d'autant plus que le mois avance.
  const ops = opsHistorique();
  const prec = [1, 2, 3].map((n) => decalerMois(m0, -n));
  const moisAvecDonnees = prec.filter((m) => ops.some((o) => o.date.startsWith(m)));
  const poids = moisAvecDonnees.length ? k.jour / k.nbJours : 1;
  const rythmeDe = (c) => {
    const actuel = c.depense / ecoules;
    if (poids >= 1) return actuel;
    const total = ops.filter((o) => !o.projet && !o.epargne && o.cat === c.id && moisAvecDonnees.includes(o.date.slice(0, 7)))
      .reduce((t, o) => t - o.montant, 0);
    const habituel = total / moisAvecDonnees.reduce((t, m) => t + joursDansMois(m), 0);
    return poids * actuel + (1 - poids) * habituel;
  };
  const cats = k.cats.map((c) => {
    let depense;
    // Opérations prévues de cette catégorie, entre aujourd'hui (ou le 1er du mois de D) et D.
    const prevues = p.evenements.filter((e) => e.cat === c.id && e.date <= D && (mD === m0 ? e.date > auj : e.date >= `${mD}-01`))
      .reduce((t, e) => t - e.montant, 0);
    if (c.type === 'enveloppe') {
      const rythme = rythmeDe(c);
      depense = mD === m0 ? c.depense + rythme * joursAvant : rythme * jourD;
    } else if (c.type === 'fixe') {
      depense = (mD === m0 ? c.depense : 0) + prevues;
    } else {
      depense = mD === m0 ? c.depense : 0;
    }
    return { ...c, depense: Math.round(depense) };
  });
  const budgetes = cats.filter((c) => c.type === 'fixe' || c.type === 'enveloppe');
  const totalDepense = budgetes.reduce((t, c) => t + Math.max(c.depense, 0), 0) + (mD === m0 ? Math.max(k.depenseAClasser, 0) : 0);
  const resteEnveloppes = cats.filter((c) => c.type === 'enveloppe').reduce((t, c) => t + Math.max(c.budget - c.depense, 0), 0);
  return {
    ...k, cats, totalDepense, resteEnveloppes, enCours: true, passe: false,
    jour: jourD, nbJours: nbD, fraction: jourD / nbD, joursRestants: nbD - jourD + 1, aClasser: 0, depenseAClasser: 0,
    titre: `Reste prévu le ${dateCourteJ(D)}`, mois: mD,
  };
}

function majCurseur() {
  const enCours = donnees?.mois === moisCourant() && prevision;
  $('curseur').hidden = !enCours;
  if (!enCours) { semaines = 0; document.body.classList.remove('projection'); $('cur-info').hidden = true; return; }
  const auj = aujourdhui();
  const max = Math.floor((Date.parse(prevision.horizon) - Date.parse(auj)) / (7 * 86400000));
  semaines = Math.min(semaines, max);
  $('cur-prec').disabled = semaines <= 0;
  $('cur-auj').hidden = semaines <= 0;
  $('cur-suiv').disabled = semaines >= max;
  const D = plusJours(auj, 7 * semaines);
  document.body.classList.toggle('projection', semaines > 0);
  $('cur-info').hidden = semaines === 0;
  if (semaines === 0) {
    $('cur-nom').textContent = 'Aujourd’hui';
    dessinerAccueil(donnees, calcul);
    document.querySelectorAll('#page-accueil .mois-nom').forEach((e) => { e.textContent = nomMois(donnees.mois); });
    $('prev-fin-titre').textContent = 'Fin du mois';
    $('prev-fin').textContent = fmt(prevision.fin);
    $('prev-fin').classList.toggle('negatif', prevision.fin < 0);
    marquerDate(null);
    return;
  }
  $('cur-nom').textContent = `Dans ${semaines} semaine${semaines > 1 ? 's' : ''} · ${dateCourteJ(D)}`;
  const kp = projeter(D);
  dessinerAccueil(donnees, kp);
  document.querySelectorAll('#page-accueil .mois-nom').forEach((e) => { e.textContent = nomMois(kp.mois); });
  const point = prevision.prevu.find(([j]) => j === D);
  const solde = point ? point[1] : prevision.fin;
  const avant = prevision.evenements.filter((e) => e.date > auj && e.date <= D);
  $('cur-info').innerHTML = `Projection au <b>${dateLongue(D)}</b> : solde prévu <b class="${solde < 0 ? 'negatif' : ''}">${fmt(solde)}</b>, `
    + `après ${avant.length} opération${avant.length > 1 ? 's' : ''} prévue${avant.length > 1 ? 's' : ''}. `
    + 'Dépenses courantes au rythme du mois mêlé à celui des 3 derniers mois. <button id="cur-retour">Revenir à aujourd’hui</button>';
  $('cur-retour').addEventListener('click', () => { semaines = 0; majCurseur(); });
  $('prev-fin-titre').textContent = `Le ${dateCourteJ(D)}`;
  $('prev-fin').textContent = fmt(solde);
  $('prev-fin').classList.toggle('negatif', solde < 0);
  marquerDate(D);
}
$('cur-prec').addEventListener('click', () => { semaines = Math.max(0, semaines - 1); majCurseur(); });
$('cur-suiv').addEventListener('click', () => { semaines++; majCurseur(); });

// Trait vertical sur la courbe de prévision, à la date du curseur.
let dateMarquee = null;
function marquerDate(D) {
  dateMarquee = D;
  graphs['g-prevision']?.update('none');
}
const pluginMarque = {
  id: 'marque',
  afterDatasetsDraw(chart) {
    if (chart.canvas.id !== 'g-prevision' || !dateMarquee) return;
    const i = chart.data.labels.indexOf(dateMarquee);
    if (i < 0) return;
    const x = chart.scales.x.getPixelForValue(i);
    const { top, bottom } = chart.chartArea;
    const c = chart.ctx;
    c.save(); c.strokeStyle = couleur('--encre'); c.lineWidth = 1.5; c.setLineDash([3, 3]);
    c.beginPath(); c.moveTo(x, top); c.lineTo(x, bottom); c.stroke(); c.restore();
  },
};
(function enregistrerPlugin() { if (typeof Chart === 'undefined') { setTimeout(enregistrerPlugin, 200); return; } Chart.register(pluginMarque); })();


// ---------- projets : livret, plan mois par mois, échéanciers ----------
// Sorties prévues de chaque projet, mois par mois, à partir du mois en cours.
// Avec un échéancier : on le suit ; ce qui est déjà dépensé est déduit des premières échéances
// (ou le retard est reporté sur ce mois) et l'écart avec le budget va au dernier mois.
// Sans échéancier : le reste est réparti à parts égales sur les mois restants.
function sortiesProjet(p, m0) {
  const reste = Math.max(p.budget - Math.max(p.depense, 0), 0);
  if (!reste) return [];
  // Sans échéancier : si le projet a déjà eu sa dépense ce mois-ci (ex. impôts mensuels),
  // le reste commence le mois suivant.
  const dejaCeMois = !p.echeancier?.length && p.fin > m0 && (donnees?.operations || []).some((o) => o.projet === p.id && o.date.startsWith(m0));
  const premier = dejaCeMois ? decalerMois(m0, 1) : m0;
  const debut = p.debut > premier ? p.debut : premier;
  const fin = p.fin >= debut ? p.fin : debut;
  if (!p.echeancier?.length) {
    const mois = [];
    for (let m = debut; m <= fin && mois.length < 36; m = decalerMois(m, 1)) mois.push(m);
    const part = Math.floor(reste / mois.length);
    return mois.map((m, i) => ({ mois: m, montant: i === mois.length - 1 ? reste - part * (mois.length - 1) : part, libelle: '' }));
  }
  const parMois = {};
  let passe = 0;
  for (const e of p.echeancier) {
    if (e.mois < m0) passe += e.montant;
    else (parMois[e.mois] ??= { mois: e.mois, montant: 0, libelle: e.libelle || '' }).montant += e.montant;
  }
  const futur = Object.values(parMois).sort((a, b) => a.mois.localeCompare(b.mois));
  let avance = Math.max(p.depense, 0) - passe;   // > 0 : dépensé en avance sur le plan ; < 0 : en retard
  if (avance < 0) {
    if (futur[0]?.mois === m0) futur[0].montant -= avance;
    else futur.unshift({ mois: m0, montant: -avance, libelle: 'en retard sur l’échéancier' });
  } else {
    for (const e of futur) { const x = Math.min(e.montant, avance); e.montant -= x; avance -= x; }
  }
  let ecart = reste - futur.reduce((t, e) => t + e.montant, 0);
  if (ecart > 0) {
    const dernier = futur.length ? futur[futur.length - 1].mois : fin;
    const m = dernier > fin ? dernier : fin;
    const e = futur.find((x) => x.mois === m);
    if (e) e.montant += ecart; else futur.push({ mois: m, montant: ecart, libelle: 'non planifié' });
  } else {
    for (let i = futur.length - 1; i >= 0 && ecart < 0; i--) { const x = Math.min(futur[i].montant, -ecart); futur[i].montant -= x; ecart += x; }
  }
  return futur.filter((e) => e.montant > 0);
}

function planProjets(d) {
  const m0 = moisCourant();
  const actifs = d.projets.filter((p) => !p.archive && (p.fin >= m0 || p.budget > p.depense));
  const parMois = {};
  const mois = (m) => (parMois[m] ??= { mois: m, rentrees: [], sorties: [] });
  for (const p of actifs) for (const e of sortiesProjet(p, m0)) mois(e.mois).sorties.push({ ...e, projet: p.nom });
  const enRetard = [];
  for (const r of d.livret?.rentrees || []) {
    if (r.mois < m0) enRetard.push(r);
    mois(r.mois < m0 ? m0 : r.mois).rentrees.push(r);
  }
  mois(m0);
  const lignes = Object.values(parMois).sort((a, b) => a.mois.localeCompare(b.mois)).slice(0, 36);
  let solde = d.livret?.solde ?? 0;
  let premierNegatif = null, plusBas = null;
  for (const l of lignes) {
    l.entree = l.rentrees.reduce((t, r) => t + r.montant, 0);
    l.sortie = l.sorties.reduce((t, s) => t + s.montant, 0);
    solde += l.entree - l.sortie;
    l.solde = solde;
    if (solde < 0 && !premierNegatif) premierNegatif = l;
    if (!plusBas || solde < plusBas.solde) plusBas = l;
  }
  const resteTotal = actifs.reduce((t, p) => t + Math.max(p.budget - p.depense, 0), 0);
  const rentreesTotal = (d.livret?.rentrees || []).reduce((t, r) => t + r.montant, 0);
  return { lignes, premierNegatif, plusBas, enRetard, resteTotal, rentreesTotal, connu: d.livret?.solde != null };
}
function resumePlan(plan) {
  if (!plan.connu) return 'Saisis le solde du livret pour vérifier le financement des projets.';
  if (!plan.premierNegatif) return `Projets financés ✓ (au plus bas : ${fmt(plan.plusBas.solde)} en ${nomMois(plan.plusBas.mois).split(' ')[0]})`;
  const l = plan.premierNegatif;
  const cause = [...l.sorties].sort((a, b) => b.montant - a.montant)[0]?.projet;
  return `<b class="negatif">Il manquera ${fmt(-l.solde)} en ${nomMois(l.mois).split(' ')[0]}</b>${cause ? ` (${echapper(cause)})` : ''}`;
}

function dessinerPageProjets() {
  const d = donnees;
  if (!d?.projets) return;
  const plan = planProjets(d);
  // Livret
  $('livret').innerHTML = d.livret?.solde != null
    ? `<span class="livret-haut"><span>Livret projets</span><b>${fmt(d.livret.solde)}</b></span>
      <span class="livret-detail">Reste à dépenser sur les projets : ${fmt(plan.resteTotal)}${plan.rentreesTotal ? ` · rentrées prévues : +${fmt(plan.rentreesTotal)}` : ''}</span>
      <small>Solde saisi le ${new Date(`${d.livret.date}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })} · toucher pour le mettre à jour</small>`
    : `<span class="livret-haut"><span>Livret projets</span><b>?</b></span><small>Touche ici pour saisir le solde de ton livret projets.</small>`;
  // Résumé et plan
  $('plan-resume').innerHTML = resumePlan(plan) + (plan.enRetard.length ? `<br><small class="attention">${plan.enRetard.length} rentrée(s) prévue(s) d’un mois passé : versement faite ? Mets à jour le solde et supprime la ligne.</small>` : '');
  $('plan').innerHTML = plan.lignes.map((l) => `<div class="plan-mois ${l.solde < 0 ? 'manque' : ''}">
      <div class="plan-tete"><b>${nomMois(l.mois)}</b><span>livret fin de mois <b class="${l.solde < 0 ? 'negatif' : ''}">${fmt(l.solde)}</b></span></div>
      <ul>${l.rentrees.map((r) => `<li class="plus"><span>${echapper(r.libelle)}</span><b>+${fmt(r.montant)}</b></li>`).join('')}
      ${l.sorties.map((s) => `<li><span>${echapper(s.projet)}${s.libelle ? ` <small>${echapper(s.libelle)}</small>` : ''}</span><b>−${fmt(s.montant)}</b></li>`).join('')}
      ${!l.rentrees.length && !l.sorties.length ? '<li class="vide">Rien de prévu</li>' : ''}</ul></div>`).join('');
  // Rentrées
  $('rentrees').innerHTML = (d.livret?.rentrees || []).map((r) => `<li><button data-rentree="${echapper(r.id)}"><span>${echapper(r.libelle)} <small>${nomMois(r.mois)}</small></span>
    <b class="positif">+${fmt(r.montant)}</b></button></li>`).join('') || '<li class="vide">Aucune rentrée prévue.</li>';
  // Projets
  const admin = !!moi?.admin;
  $('btn-nouveau-projet').hidden = !admin || !$('form-projet').hidden;
  const tri = [...d.projets].sort((a, b) => (a.archive - b.archive) || a.debut.localeCompare(b.debut));
  $('liste-projets').innerHTML = tri.map((p) => {
    const sorties = sortiesProjet(p, moisCourant());
    const plan = p.archive ? 'archivé' : sorties.length ? `à venir : ${sorties.map((e) => `${moisCourtNom(e.mois)} ${fmtCourt(e.montant)}`).join(' · ')}` : 'entièrement dépensé';
    const ligne = barre(p.nom, p.depense, p.budget, `${periode(p)} · ${p.nombre} opération(s) · ${plan}${p.echeancier?.length ? ' · échéancier' : ''}`);
    const action = admin ? `<button class="action" data-projet="${echapper(p.id)}">Modifier</button>` : '';
    return ligne.replace(/^<li>/, `<li class="${p.archive ? 'archive' : ''}">`).replace(/<\/li>$/, `${action}</li>`);
  }).join('') || '<li class="vide">Aucun projet.</li>';
}

// Solde du livret
$('livret').addEventListener('click', async () => {
  const actuel = donnees?.livret?.solde != null ? (donnees.livret.solde / 100).toFixed(2).replace('.', ',') : '';
  const saisie = prompt('Solde actuel du livret projets (€) :', actuel);
  if (saisie === null || !saisie.trim()) return;
  const centimes = Math.round(Number(saisie.replace(/\s/g, '').replace(',', '.')) * 100);
  if (!Number.isFinite(centimes)) { alert('Montant invalide.'); return; }
  try { await api('/api/livret', { method: 'PUT', body: JSON.stringify({ solde: centimes }) }); await charger({ garderHistorique: true }); dessinerPageProjets(); }
  catch (e) { alert(e.message); }
});
$('resume-livret').addEventListener('click', () => afficherPage('projets'));

// Rentrées prévues
async function enregistrerRentrees(modif) {
  const rentrees = [...(donnees.livret?.rentrees || [])];
  modif(rentrees);
  try { await api('/api/livret', { method: 'PUT', body: JSON.stringify({ rentrees }) }); await charger({ garderHistorique: true }); dessinerPageProjets(); }
  catch (e) { alert(e.message); }
}
$('btn-ajout-rentree').addEventListener('click', () => {
  $('form-rentree').reset();
  $('rentree-mois').value = moisCourant();
  $('dlg-rentree').showModal();
});
$('dlg-rentree').addEventListener('close', () => {
  if ($('dlg-rentree').returnValue !== 'ok') return;
  const r = { id: crypto.randomUUID?.() || String(Date.now()), libelle: $('rentree-libelle').value.trim(), mois: $('rentree-mois').value, montant: enCentimesSaisis($('rentree-montant').value) };
  enregistrerRentrees((l) => l.push(r));
});
$('rentrees').addEventListener('click', (e) => {
  const b = e.target.closest('[data-rentree]');
  if (!b) return;
  const r = donnees.livret.rentrees.find((x) => x.id === b.dataset.rentree);
  if (r && confirm(`Supprimer la rentrée prévue « ${r.libelle} » (${fmt(r.montant)}, ${nomMois(r.mois)}) ?`)) enregistrerRentrees((l) => l.splice(l.indexOf(l.find((x) => x.id === r.id)), 1));
});

// Formulaire projet et échéancier
function ligneEcheance(e = {}) {
  return `<div class="ligne-echeance">
    <input type="month" class="ech-mois" value="${echapper(e.mois || '')}" aria-label="Mois" required>
    <input type="number" class="ech-montant" inputmode="decimal" min="0" step="1" value="${e.montant ? enEuros(e.montant) : ''}" placeholder="€" aria-label="Montant" required>
    <input class="ech-libelle" maxlength="60" value="${echapper(e.libelle || '')}" placeholder="ex. Réservations" aria-label="Libellé">
    <button type="button" class="action danger ech-suppr" aria-label="Retirer l’échéance">×</button></div>`;
}
function lireEcheancier() {
  return [...document.querySelectorAll('.ligne-echeance')].map((l) => ({
    mois: l.querySelector('.ech-mois').value, montant: enCentimesSaisis(l.querySelector('.ech-montant').value), libelle: l.querySelector('.ech-libelle').value.trim(),
  })).filter((e) => e.mois && e.montant > 0);
}
function majResumeEcheancier() {
  const budget = enCentimesSaisis($('projet-budget').value);
  const ech = lireEcheancier();
  const total = ech.reduce((t, e) => t + e.montant, 0);
  $('echeancier-resume').textContent = !ech.length ? 'Pas d’échéancier : budget réparti à parts égales sur les mois du projet.'
    : total === budget ? `Échéancier complet : ${fmt(total)} ✓`
    : total < budget ? `Échéancier : ${fmt(total)} sur ${fmt(budget)}. Les ${fmt(budget - total)} non planifiés iront au dernier mois.`
    : `Attention : l’échéancier (${fmt(total)}) dépasse le budget (${fmt(budget)}).`;
}
function ouvrirProjet(p) {
  $('form-projet').hidden = false;
  $('btn-nouveau-projet').hidden = true;
  $('projet-id').value = p?.id || '';
  $('projet-nom').value = p?.nom || '';
  $('projet-budget').value = p ? enEuros(p.budget) : '';
  $('projet-debut').value = p?.debut || moisCourant();
  $('projet-fin').value = p?.fin || moisCourant();
  $('projet-motif').value = p?.motif || '';
  $('projet-archive').checked = !!p?.archive;
  $('echeancier').innerHTML = (p?.echeancier || []).map(ligneEcheance).join('');
  majResumeEcheancier();
  $('btn-supprimer-projet').hidden = !p;
  $('form-projet').scrollIntoView({ block: 'start' });
}
function fermerProjet() { $('form-projet').hidden = true; $('btn-nouveau-projet').hidden = !moi?.admin; }
$('btn-nouveau-projet').addEventListener('click', () => ouvrirProjet(null));
$('btn-annuler-projet').addEventListener('click', fermerProjet);
$('liste-projets').addEventListener('click', (e) => {
  const b = e.target.closest('[data-projet]');
  if (b) ouvrirProjet(donnees.projets.find((p) => p.id === b.dataset.projet));
});
$('btn-ajout-echeance').addEventListener('click', () => {
  $('echeancier').insertAdjacentHTML('beforeend', ligneEcheance({ mois: $('projet-debut').value }));
  majResumeEcheancier();
});
$('echeancier').addEventListener('click', (e) => { if (e.target.classList.contains('ech-suppr')) { e.target.closest('.ligne-echeance').remove(); majResumeEcheancier(); } });
$('form-projet').addEventListener('input', majResumeEcheancier);
$('form-projet').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('projet-id').value;
  const corps = {
    nom: $('projet-nom').value, budget: enCentimesSaisis($('projet-budget').value),
    debut: $('projet-debut').value, fin: $('projet-fin').value, motif: $('projet-motif').value, archive: $('projet-archive').checked,
    echeancier: lireEcheancier(),
  };
  try {
    await api(id ? `/api/projets/${encodeURIComponent(id)}` : '/api/projets', { method: id ? 'PUT' : 'POST', body: JSON.stringify(corps) });
    fermerProjet();
    await charger();
    dessinerPageProjets();
  } catch (err) { alert(err.message); }
});
$('btn-supprimer-projet').addEventListener('click', async () => {
  if (!confirm('Supprimer ce projet ? Ses opérations reviendront dans les budgets du mois.')) return;
  await api(`/api/projets/${encodeURIComponent($('projet-id').value)}`, { method: 'DELETE' }).catch((e) => alert(e.message));
  fermerProjet();
  await charger();
  dessinerPageProjets();
});

// ---------- retour à aujourd'hui (curseur) ----------
$('cur-auj').addEventListener('click', () => { semaines = 0; majCurseur(); });

// ---------- guide rapide (l'essentiel pour suivre le budget, sans les réglages) ----------
const GUIDE = [
  ['👋', 'Bienvenue dans Budget', 'Les opérations du compte joint et des deux cartes arrivent toutes seules, deux fois par jour. Il n’y a rien à saisir. Ce guide te montre où regarder.'],
  ['🎯', 'Le chiffre du haut', 'C’est ce qu’il reste ce mois-ci pour le quotidien : courses, shopping, transports. Quand il passe <b class="negatif">en rouge</b>, le budget du mois est dépassé : chaque dépense en plus creuse l’écart.'],
  ['⭕', 'Les anneaux', 'Un anneau par poste. Le <b>trait noir</b> montre où on devrait en être aujourd’hui : si l’anneau le dépasse, on va trop vite. Dessous : ce qu’il reste, et combien on peut dépenser par jour.'],
  ['📉', 'Le solde à venir', 'Les cartes sont débitées une fois par mois, vers le 4. La courbe « Prévision du solde » montre le solde prévu et le <b>point bas</b> : c’est là que le compte risque le découvert. Les flèches ‹ › en haut avancent semaine par semaine.'],
  ['🧳', 'Les projets', 'Les grosses dépenses prévues (vacances, cadeaux de Noël, impôts…) ont leur propre budget, financé par le <b>livret projets</b> : elles ne comptent pas dans le quotidien. Sur l’accueil, la ligne « Livret projets » est <b>verte</b> si tout est financé, <b class="negatif">rouge</b> s’il manquera de l’argent, et quand. L’onglet <b>Projets</b> montre le plan mois par mois.'],
  ['🏷️', 'Classer une opération', 'Onglet <b>Opérations</b>, puis « À classer ». Touche une opération et choisis sa catégorie, ou le projet auquel elle appartient (une dépense du voyage en Italie, par exemple). Coche « Faire de même… » pour que l’app s’en souvienne.'],
  ['✅', 'C’est tout !', 'Les montants des budgets et des projets, ainsi que les réglages, sont gérés par l’administrateur. Pour revoir ce guide : le bouton <b>?</b> en haut de l’écran.'],
];
let etapeGuide = 0;
function ouvrirGuide() {
  etapeGuide = 0;
  afficherEtapeGuide();
  if (!$('dlg-guide').open) $('dlg-guide').showModal();
}
function afficherEtapeGuide() {
  const [icone, titre, texte] = GUIDE[etapeGuide];
  $('guide-etapes').innerHTML = `<div class="guide-icone" aria-hidden="true">${icone}</div><h2>${titre}</h2><p>${texte}</p>`;
  $('guide-points').innerHTML = GUIDE.map((_, i) => `<i class="${i === etapeGuide ? 'actif' : ''}"></i>`).join('');
  $('guide-prec').style.visibility = etapeGuide ? 'visible' : 'hidden';
  $('guide-suiv').textContent = etapeGuide === GUIDE.length - 1 ? 'Compris' : 'Suivant';
}
$('guide-prec').addEventListener('click', () => { etapeGuide = Math.max(0, etapeGuide - 1); afficherEtapeGuide(); });
$('guide-suiv').addEventListener('click', () => {
  if (etapeGuide < GUIDE.length - 1) { etapeGuide++; afficherEtapeGuide(); return; }
  $('dlg-guide').close();
});
$('dlg-guide').addEventListener('close', () => ecrire('guide-vu', true));
$('btn-guide').addEventListener('click', ouvrirGuide);
$('btn-guide-reglages').addEventListener('click', ouvrirGuide);

// ---------- atterrissage du mois (résultat : revenus du mois − dépenses du mois) ----------
// Les achats carte comptent le mois de l'achat ; l'épargne programmée compte comme une dépense ;
// les projets (financés par le livret) et les virements internes sont à part.
// Pour le mois en cours : pré-clôture, avec les rentrées et dépenses encore attendues.
function atterrissage(m) {
  const d = donnees;
  const ops = opsHistorique().filter((o) => !o.epargne && !o.projet);
  const types = Object.fromEntries(d.categories.map((c) => [c.id, c.type]));
  const duMois = ops.filter((o) => o.date.startsWith(m));
  const revenus = duMois.filter((o) => o.cat === 'revenus').reduce((t, o) => t + o.montant, 0);
  const depenses = -duMois.filter((o) => o.cat !== 'revenus' && (!o.cat || types[o.cat] !== 'hors')).reduce((t, o) => t + o.montant, 0);

  // Revenus exceptionnels : rentrées ponctuelles (≥ 300 €) ou surplus d'une rentrée habituelle (13e mois…).
  const parCle = {};
  for (const o of ops.filter((x) => x.cat === 'revenus' && x.montant > 0)) {
    const k = cleRecurrence(o), mo = o.date.slice(0, 7);
    ((parCle[k] ??= {})[mo] ??= 0);
    parCle[k][mo] += o.montant;
  }
  let exceptionnel = 0;
  for (const parMois of Object.values(parCle)) {
    const v = parMois[m];
    if (!v) continue;
    const valeurs = Object.values(parMois);
    if (valeurs.length <= 2) { if (v >= 30000) exceptionnel += v; continue; }
    const surplus = v - mediane(valeurs);
    if (surplus >= 30000) exceptionnel += surplus;
  }

  let revenusAttendus = 0, depensesAVenir = 0, fixesAVenir = 0, quotidienAVenir = 0;
  const prevu = m === moisCourant();
  if (prevu && prevision && calcul && donnees.mois === m) {
    const auj = aujourdhui(), fin = `${m}-${String(joursDansMois(m)).padStart(2, '0')}`;
    for (const e of prevision.evenements) {
      if (e.carte || e.date <= auj || e.date > fin || e.recurrence?.projet) continue;
      if (e.montant > 0) { if (!e.cat || e.cat === 'revenus') revenusAttendus += e.montant; continue; }
      if (e.cat && (types[e.cat] === 'hors' || types[e.cat] === 'enveloppe')) continue;
      fixesAVenir -= e.montant;
    }
    const proj = projeter(fin);
    for (const c of proj.cats) {
      if (c.type !== 'enveloppe') continue;
      const actuel = calcul.cats.find((x) => x.id === c.id)?.depense || 0;
      quotidienAVenir += Math.max(c.depense - actuel, 0);
    }
    depensesAVenir = fixesAVenir + quotidienAVenir;
  }
  const resultat = revenus + revenusAttendus - depenses - depensesAVenir;
  return { mois: m, revenus, revenusAttendus, exceptionnel, depenses, depensesAVenir, fixesAVenir, quotidienAVenir, resultat, prevu };
}

const moisNom = (m) => nomMois(m).split(' ')[0];
const deMois = (m) => (/^[aeiouyàâéèêîôû]/i.test(moisNom(m)) ? `d’${moisNom(m)}` : `de ${moisNom(m)}`);
function texteAtterrissage(a) {
  return `${a.prevu ? `Atterrissage ${deMois(a.mois)} prévu` : `Clôture ${deMois(a.mois)}`} : ${fmtSigne(a.resultat)}`;
}

let moisAtterrissage = null;
function dessinerDetailAtterrissage(a) {
  const ex = a.exceptionnel ? ` <small>dont ${fmt(a.exceptionnel)} exceptionnels</small>` : '';
  $('atterrissage-detail').innerHTML = `
    <div class="att-titre">${a.prevu ? `${nomMois(a.mois)} · pré-clôture` : `${nomMois(a.mois)} · clôture`}</div>
    <div class="att-ligne"><span>Revenus du mois${ex}${a.revenusAttendus ? `<small>dont ${fmt(a.revenusAttendus)} encore attendus</small>` : ''}</span><b>${fmt(a.revenus + a.revenusAttendus)}</b></div>
    <div class="att-ligne"><span>Dépenses du mois<small>épargne programmée comprise${a.depensesAVenir ? ` · dont ${fmt(a.depensesAVenir)} encore à venir (${[a.fixesAVenir ? `${fmt(a.fixesAVenir)} de prélèvements` : '', a.quotidienAVenir ? `${fmt(a.quotidienAVenir)} de quotidien au rythme habituel` : ''].filter(Boolean).join(', ')})` : ''}</small></span><b>−${fmt(a.depenses + a.depensesAVenir)}</b></div>
    <div class="att-ligne att-total ${a.resultat < 0 ? 'negatif' : 'positif'}"><span>${a.resultat >= 0 ? 'Ce que le mois laisse' : 'Ce que le mois coûte'}</span><b>${fmtSigne(a.resultat)}</b></div>
    ${a.exceptionnel ? `<div class="att-ligne att-hors"><span>Hors revenus exceptionnels</span><b class="${a.resultat - a.exceptionnel < 0 ? 'negatif' : ''}">${fmtSigne(a.resultat - a.exceptionnel)}</b></div>` : ''}`;
}

function dessinerAtterrissages(moisL) {
  const liste = moisL.map(atterrissage).filter((a, i) => i > 0 || a.revenus || a.depenses);   // premier mois souvent incomplet
  if (!moisAtterrissage || !liste.some((a) => a.mois === moisAtterrissage)) moisAtterrissage = liste[liste.length - 1]?.mois;
  const choisi = liste.find((a) => a.mois === moisAtterrissage);
  if (choisi) dessinerDetailAtterrissage(choisi);
  const s1 = couleur('--serie-1'), s2 = couleur('--serie-2'), s3 = couleur('--serie-3');
  $('legende-atterrissage').innerHTML = `<span><i style="background:${s1}"></i>Mois positif</span><span><i style="background:${s2}"></i>Mois négatif</span><span><i style="background:${s3}"></i>Revenus exceptionnels</span><span>* mois en cours, prévu</span>`;
  const base = liste.map((a) => (a.resultat - Math.min(a.exceptionnel, Math.max(a.resultat, 0))) / 100);
  const exc = liste.map((a) => Math.min(a.exceptionnel, Math.max(a.resultat, 0)) / 100);
  graphique('g-atterrissage', {
    type: 'bar',
    data: {
      labels: liste.map((a) => `${moisCourtNom(a.mois)}${a.prevu ? '*' : ''}`),
      datasets: [
        { label: 'Atterrissage', data: base, backgroundColor: liste.map((a, i) => (base[i] < 0 ? s2 : s1) + (a.prevu ? '99' : '')),
          borderRadius: 4, borderSkipped: false, maxBarThickness: 22, stack: 's' },
        { label: 'dont revenus exceptionnels', data: exc, backgroundColor: s3, borderRadius: 4, borderSkipped: 'bottom', maxBarThickness: 22, stack: 's' },
      ],
    },
    options: (() => {
      const o = optionsCommunes();
      o.scales.x.stacked = true; o.scales.y.stacked = true;
      o.scales.y.grid.color = (c) => (c.tick.value === 0 ? couleur('--encre-2') : couleur('--filet'));
      o.plugins.tooltip.callbacks.title = (items) => texteAtterrissage(liste[items[0].dataIndex]);
      o.onClick = (_e, el) => { if (!el.length) return; moisAtterrissage = liste[el[0].index].mois; dessinerDetailAtterrissage(liste[el[0].index]); };
      return o;
    })(),
  });
  tableau('t-atterrissage', ['Mois', 'Revenus', 'dont exceptionnels', 'Dépenses', 'Atterrissage'],
    liste.map((a) => [`${nomMois(a.mois)}${a.prevu ? ' (prévu)' : ''}`, fmt(a.revenus + a.revenusAttendus), fmt(a.exceptionnel), fmt(a.depenses + a.depensesAVenir), fmtSigne(a.resultat)]));
}

// Ligne de conclusion en bas de l'accueil, pour le mois affiché.
async function majLigneAtterrissage() {
  const d = donnees;
  if (!d?.comptes?.length) { $('ligne-atterrissage').hidden = true; return; }
  try { await chargerHistorique(); } catch { return; }
  if (d.mois === moisCourant() && !prevision) return;   // attend la prévision
  const a = atterrissage(d.mois);
  if (!a.revenus && !a.depenses) { $('ligne-atterrissage').hidden = true; return; }
  $('ligne-atterrissage').hidden = false;
  $('ligne-atterrissage').classList.toggle('negatif-bord', a.resultat < 0);
  $('ligne-atterrissage').innerHTML = `<span>${texteAtterrissage(a).replace(/ : .*/, '')}</span>
    <b class="${a.resultat < 0 ? 'negatif' : 'positif'}">${fmtSigne(a.resultat)}</b>
    <small>${a.exceptionnel ? `dont ${fmt(a.exceptionnel)} de revenus exceptionnels · ` : ''}revenus − dépenses du mois, épargne comprise ›</small>`;
}
$('ligne-atterrissage').addEventListener('click', () => { moisAtterrissage = donnees.mois; afficherPage('graphiques'); });

// Cartes de l'accueil : voir les paiements à débiter.
$('comptes').addEventListener('click', (e) => {
  const li = e.target.closest('[data-carte-ops]');
  if (!li) return;
  afficherPage('operations');
  choisirFiltre(`k:${li.dataset.carteOps}`);
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
demarrer();
