# FM27 Adjoint

Entraîneur adjoint personnel pour Football Manager 27 (PC). Il regarde les écrans du jeu, mémorise le contexte de chaque carrière et donne des conseils concrets **en français**, en séparant toujours ce qui est lu, ce qui est incertain, les hypothèses et les corrections proposées.

Application indépendante, non affiliée à Sports Interactive. Elle lit des **captures d'écran** : pas de lecture de la mémoire du jeu, aucune modification de ses fichiers.

## Installer (une seule fois)

1. Ouvre la page **[Releases](https://github.com/nonorigon-design/fm27-adjoint/releases/latest)**.
2. Télécharge `FM27-Adjoint-Setup-x.y.z.exe` et double-clique dessus.
3. L'installation est automatique (pour ton compte Windows, sans droits administrateur). Un raccourci **FM27 Adjoint** est créé sur le Bureau et l'application s'ouvre.

Windows SmartScreen peut afficher « Windows a protégé votre PC » car l'installateur n'est pas signé par un certificat payant : clique sur **Informations complémentaires → Exécuter quand même**.

Aucun Python, terminal ni commande n'est nécessaire. Fermer une fenêtre de terminal ne ferme jamais l'application (il n'y en a pas).

## Mises à jour

L'application vérifie GitHub au démarrage (bouton **Réglages IA et application → Rechercher une mise à jour**), télécharge la nouvelle version avec une barre de progression, vérifie son empreinte SHA-512, puis propose **Redémarrer et installer**. Sans Internet, la version installée s'ouvre normalement. Réglages, clé Gemini et carrières sont conservés (ils vivent dans `%APPDATA%\FM27 Adjoint`, hors du dossier du programme).

> Si tu utilisais l'ancienne version (Python, `DEMARRER.bat`) : son lanceur est redirigé automatiquement vers cet installateur dès la publication de la première version (voir « Migration »).

## Utilisation

1. **Capturer** : bouton *Capturer Football Manager*, raccourci global (par défaut `Ctrl+Alt+A`, modifiable), ou *Importer…* pour tes propres images. Jusqu'à 6 captures (A à F), consultables en grand d'un clic.
2. **Choisir la section** : Tactique, Joueurs, Avant-match, Débrief, Recrutement, Discussion. Ta question en cours est conservée quand tu changes de section.
3. **Analyser maintenant**. Le rapport est structuré : faits lus / incertain / hypothèses / corrections (problème, preuves, changement, effet, risque, vérification) / écrans à fournir.
4. **Historique et changements testés** (menu de gauche) : retrouve les rapports de la carrière et note chaque changement tactique avec son résultat, pour que l'adjoint compare dans la durée.

### Deux écrans
Laisse FM en grand sur l'écran principal et l'adjoint sur le second. La capture de fenêtre fonctionne même si une autre fenêtre (l'adjoint) est posée à côté ; elle **ne fonctionne pas** si FM est réduit dans la barre des tâches. En « plein écran exclusif », Windows peut renvoyer une image noire : l'adjoint le détecte et te le dit. Passe alors FM en *plein écran fenêtré* ou utilise *Autre fenêtre ou écran entier*, ou importe une capture.

### Surveillance
Optionnelle. Elle repère qu'un nouvel écran stable est apparu et te propose de l'ajouter. **Elle n'envoie jamais rien** : seule la capture que tu ajoutes puis analyses est transmise au moteur choisi.

## Moteur IA

| | Moteur local (Ollama) | Gemini (en ligne) |
|---|---|---|
| Coût | Gratuit, utilise ton PC | Palier gratuit de Google selon ton projet |
| Confidentialité | 100 % local | Captures envoyées à Google à chaque analyse ; sur le palier gratuit Google indique pouvoir utiliser le contenu pour améliorer ses produits |
| Installation | Depuis l'application (Ollama + modèle recommandé selon ton matériel) | Colle une clé une seule fois |

* **Local** : l'application détecte ta RAM et ta carte graphique et recommande un modèle de vision `qwen3-vl` (2b ≈ 1,9 Go, 4b ≈ 3,3 Go, 8b ≈ 6,1 Go) en laissant de la marge à FM. Le téléchargement affiche taille et progression ; interrompu, le relancer reprend. Le modèle est déchargé de la mémoire 2 minutes après l'analyse. *Aucune comparaison de qualité n'a été faite : le modèle recommandé est un compromis, pas un « meilleur ».*
* **Gemini** : la clé est vérifiée auprès de Google **avant** d'être enregistrée, puis chiffrée par ton compte Windows (DPAPI). Elle est restaurée au lancement, remplaçable ou oubliable, et jamais écrite dans le journal. Les erreurs sont distinctes : clé invalide, accès refusé, **quota atteint** (avec délai/portée journalière ou par minute si Google l'indique), modèle introuvable, modèle sans vision, connexion. Aucun nouvel essai automatique, aucun passage à un service payant.

## Publier une correction (mainteneur)

1. Modifier le code, `npm test`.
2. Augmenter `version` dans `package.json` (ex. `2.0.1`), commit, push sur `main`.
3. `git tag v2.0.1 && git push origin v2.0.1`.

GitHub Actions (`.github/workflows/build.yml`) exécute les tests, compile l'installateur Windows, **l'installe réellement sur un Windows propre, vérifie le raccourci et démarre l'application installée** (test de fumée). Ce n'est qu'après ce contrôle que la version est publiée dans *Releases*. Toutes les installations la reçoivent ensuite au démarrage. Un échec bloque la publication : les utilisateurs gardent la version précédente.

Développement local : `npm install`, `npm start`.

## Migration depuis les versions Python
`legacy/` conserve l'ancien code. À chaque publication, la CI régénère `update.json` : les anciens lanceurs y trouvent un petit programme qui télécharge l'installateur officiel (empreinte SHA-256 vérifiée), l'exécute puis ouvre la nouvelle application. L'ancien historique (`historique.sqlite`) est repris au premier lancement ; la clé Gemini, chiffrée autrement, est à ressaisir une fois.

## Limites connues
* L'installateur n'est pas signé (avertissement SmartScreen).
* Pas de retour arrière automatique intégré : si une version ne démarre pas, l'application le signale au lancement suivant et propose de réinstaller la précédente depuis *Releases*. La protection principale est que CI ne publie qu'une version qui a démarré sur Windows.
* Une image fixe ne montre pas les déplacements : l'adjoint ne les devine pas. Les conseils viennent d'un modèle généraliste : vérifie chiffres et intitulés dans FM.


## Nouveautés 2.1.0

- **Coach en direct** : l'adjoint observe Football Manager tout seul (aucune capture à ajouter), donne un conseil court à chaque nouvel écran et se tait (« RAS ») quand il n'y a rien d'utile.
- **IA gratuite installée au lancement** : assistant de première utilisation qui installe le moteur local (Ollama) et télécharge le modèle adapté à votre machine ; le moteur démarre ensuite avec l'application.
- **« Analyser maintenant »** capture lui-même la fenêtre FM si aucune image n'est choisie.
