'use strict';
/**
 * Lecteur automatique : pour chaque nouvel écran de Football Manager, l'IA renvoie
 * 1) ce qu'elle a lu (type d'écran + faits chiffrés),
 * 2) 0 à 4 conseils concrets, classés, avec l'action à faire et l'endroit où la faire dans FM.
 * Le joueur n'a rien à demander : il lit les conseils.
 * Aucune dépendance Electron : testable seul.
 */
const { LANGUAGES } = require('./prompts');

const ECRANS = ['Effectif', 'Tactique', 'Match en direct', 'Résultat du match', 'Avant-match', 'Calendrier', 'Classement',
  'Joueur', 'Recrutement', 'Entraînement', 'Médical', 'Finances', 'Messages', 'Autre', 'Pas Football Manager'];
const DOMAINES = ['Effectif', 'Tactique', 'Match', 'Recrutement', 'Entraînement', 'Moral', 'Finances'];
const PRIORITES = ['urgent', 'important', 'idee'];

// Schéma JSON imposé au modèle (sorties structurées d'Ollama) : il ne peut pas répondre « à côté ».
const READER_SCHEMA = {
  type: 'object',
  properties: {
    ecran: { type: 'string', enum: ECRANS },
    titre_ecran: { type: 'string' },
    club: { type: 'string' },
    faits: { type: 'array', items: { type: 'object', properties: { sujet: { type: 'string' }, valeur: { type: 'string' } }, required: ['sujet', 'valeur'] } },
    conseils: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          priorite: { type: 'string', enum: PRIORITES },
          domaine: { type: 'string', enum: DOMAINES },
          titre: { type: 'string' },
          action: { type: 'string' },
          pourquoi: { type: 'string' },
          ou: { type: 'string' },
        },
        required: ['priorite', 'domaine', 'titre', 'action', 'pourquoi', 'ou'],
      },
    },
  },
  required: ['ecran', 'titre_ecran', 'faits', 'conseils'],
};

const DOMAINE_PAR_ECRAN = {
  Effectif: 'Effectif', Joueur: 'Effectif', Médical: 'Effectif', Tactique: 'Tactique', 'Match en direct': 'Match', 'Résultat du match': 'Match',
  'Avant-match': 'Match', Calendrier: 'Match', Classement: 'Match', Recrutement: 'Recrutement', Entraînement: 'Entraînement', Finances: 'Finances', Messages: 'Moral',
};

function buildReaderPrompt({ context, language } = {}) {
  const lang = (LANGUAGES[language] || LANGUAGES.fr);
  return `Tu es l'entraîneur adjoint d'un joueur de Football Manager 27. Tu regardes une capture de son écran de jeu.
Ton travail : LIRE l'écran comme un analyste, puis donner des consignes PRÉCISES que le joueur applique sans réfléchir.

ÉTAPE 1 — LIRE
- "ecran" : le type d'écran parmi la liste imposée. Si ce n'est pas Football Manager : "Pas Football Manager", faits et conseils vides.
- "titre_ecran" : l'intitulé exact visible (onglet ou page).
- "club" : le club du joueur s'il est visible, sinon "".
- "faits" : 3 à 15 faits LUS, chacun avec des noms et des chiffres exacts de l'écran (note, condition, moral, poste, score, minute, statistique, montant, date). Ex. {"sujet":"Gui (MC)","valeur":"note 5.9, condition 71 %"}. N'invente rien : ce qui est illisible n'est pas un fait.

ÉTAPE 2 — CONSEILLER (0 à 4 conseils, les plus utiles d'abord)
Chaque conseil :
- "priorite" : "urgent" (à faire maintenant : blessure, carton, joueur hors du match, fatigue forte, défaite en cours), "important" (avant le prochain match), "idee" (piste d'amélioration).
- "domaine" : parmi la liste imposée.
- "titre" : 3 à 8 mots, ex. "Sortir Gui, entrer Junyent".
- "action" : UNE consigne concrète avec les NOMS de joueurs, rôles, consignes ou valeurs exacts de FM. Ex. "Remplace Gui par Quim Junyent au poste de MC et passe la mentalité sur Positive."
- "pourquoi" : une phrase qui cite le chiffre lu qui justifie le conseil. Ex. "Gui est à 5.9 à la 63e et 71 % de condition."
- "ou" : où le faire dans FM, ex. "Tactiques > Vue d'ensemble", "Match > Remplacements", "Entraînement > Programme".
INTERDIT : conseils vagues ("améliore la cohésion", "surveille la forme", "adapte ta tactique"), conseils sans nom ni chiffre, conseils qui demandent au joueur d'aller vérifier quelque chose, répétition d'un conseil déjà donné ou refusé (voir plus bas). S'il n'y a rien d'utile et de précis à dire : "conseils": [].
${context ? `\nCE QUE TU SAIS DÉJÀ DE CETTE CARRIÈRE (lu sur d'autres écrans, peut dater) :\n${context}\n` : ''}
LANGUE : ${lang.rule} Les valeurs "ecran", "priorite" et "domaine" restent exactement celles de la liste imposée.
Réponds uniquement avec l'objet JSON demandé.`;
}

const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** Extrait l'objet JSON même si le modèle ajoute du texte autour, puis le rend sûr et borné. */
function parseReading(text) {
  let raw = null;
  const s = String(text || '');
  try { raw = JSON.parse(s); } catch {
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a >= 0 && b > a) { try { raw = JSON.parse(s.slice(a, b + 1)); } catch { raw = null; } }
  }
  if (!raw || typeof raw !== 'object') return null;
  const ecran = ECRANS.includes(raw.ecran) ? raw.ecran : 'Autre';
  const faits = (Array.isArray(raw.faits) ? raw.faits : [])
    .map((f) => ({ sujet: clip(f?.sujet, 80), valeur: clip(f?.valeur, 200) }))
    .filter((f) => f.sujet && f.valeur).slice(0, 20);
  const conseils = ecran === 'Pas Football Manager' ? [] : (Array.isArray(raw.conseils) ? raw.conseils : [])
    .map((c) => ({
      priorite: PRIORITES.includes(c?.priorite) ? c.priorite : 'important',
      domaine: DOMAINES.includes(c?.domaine) ? c.domaine : (DOMAINE_PAR_ECRAN[ecran] || 'Tactique'),
      titre: clip(c?.titre, 90), action: clip(c?.action, 400), pourquoi: clip(c?.pourquoi, 300), ou: clip(c?.ou, 120),
    }))
    .filter((c) => c.titre && c.action).slice(0, 4);
  return { ecran, titre_ecran: clip(raw.titre_ecran, 80), club: clip(raw.club, 60), faits, conseils };
}

// Deux conseils sont « le même » s'ils partagent l'essentiel de leurs mots (noms de joueurs compris).
const words = (t) => new Set(String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[a-z0-9]{3,}/g) || []);
function similar(a, b) {
  const A = words(a.titre + ' ' + a.action), B = words(b.titre + ' ' + b.action);
  if (!A.size || !B.size) return false;
  let inter = 0; for (const w of A) if (B.has(w)) inter++;
  return inter / Math.min(A.size, B.size) >= 0.6;
}

module.exports = { READER_SCHEMA, ECRANS, DOMAINES, PRIORITES, buildReaderPrompt, parseReading, similar };
