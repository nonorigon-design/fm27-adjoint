# FM27 Adjoint — Windows

Application personnelle indépendante de Sports Interactive. Version 1.1.

## Installation automatique Windows 10/11

1. Extrais complètement le ZIP dans un dossier que tu conserveras (par exemple Documents\FM27_Adjoint).
2. Double-clique sur **DEMARRER.bat**.
3. Le lanceur détecte Python 3.11+ avec Tcl/Tk. Si nécessaire, il installe Python 3.13 via le dépôt Windows winget pour ton compte, puis Pillow depuis PyPI. Il accepte les conditions de ces paquets pour permettre l'installation sans intervention.
4. Il crée un raccourci **FM27 Adjoint** sur le Bureau et ouvre l'application. Conserve le dossier extrait : le raccourci pointe vers ce dossier.

Internet est nécessaire au premier démarrage. Ensuite, les composants déjà installés sont réutilisés. Le lanceur ne change pas durablement la politique PowerShell : l'option utilisée s'applique seulement à ce processus. Pas besoin de lancer en administrateur sur une installation Windows standard. Si winget manque, le message explique comment installer le Gestionnaire d'applications Microsoft ou Python.

L'environnement Python de l'application et le journal sont dans `%LOCALAPPDATA%\FM27_Adjoint`. En cas d'erreur, consulte `installation.log`. Un échec d'installation peut être repris en relançant DEMARRER.bat. LANCER.bat appelle le même lanceur.

Le moteur en ligne Gemini fonctionne sans installer Ollama. Une clé Gemini personnelle reste nécessaire : aucune clé partagée n'est incluse, aucun compte n'est créé automatiquement. Pour le mode local, suis la rubrique Ollama ci-dessous ; le téléchargement d'un modèle de plusieurs Go est distinct de l'installation de base.

Ce paquet contient des lanceurs et le code, pas un exécutable précompilé. CREER_EXE.bat reste disponible pour les utilisateurs souhaitant construire eux-mêmes un exécutable avec Python et PyInstaller.

## Gemini : analyse en ligne

Crée une clé dans https://aistudio.google.com/apikey avec un projet sans facturation pour rester dans les possibilités gratuites. Colle-la dans l'application puis clique sur **Charger les modèles**. Choisis un modèle Gemini prenant les images, accessible au quota gratuit de ton compte. La liste de l'API ne renseigne pas la gratuité ; vérifie les quotas et les prix dans AI Studio. Aucun modèle n'est présenté comme le meilleur sans essai comparatif.

La clé reste en mémoire jusqu'à la fermeture : elle n'est pas enregistrée. Les captures sélectionnées, ta question et les trois derniers rapports de la carrière (au maximum 14 000 caractères) sont transmis à Google seulement quand tu cliques sur **Demander à l'adjoint**. L'application ne peut pas désactiver la facturation d'un projet déjà payant. Elle n'effectue pas de nouvelle tentative automatique en cas de quota dépassé.

## Ollama : analyse locale

Installe Ollama depuis https://ollama.com puis télécharge un modèle avec vision, par exemple dans PowerShell :

```
ollama pull qwen3-vl:4b
```

Sélectionne **Ollama local**, charge les modèles et choisis le modèle visuel téléchargé. Ollama doit être démarré sur son adresse locale standard `127.0.0.1:11434`. Un modèle texte seul ne peut pas lire les captures. La vitesse et la mémoire nécessaire dépendent du modèle et du PC ; teste d'abord un petit modèle pendant que FM tourne. Aucun abonnement ni clé ne sont nécessaires pour ce mode local ; il utilise l'électricité et les ressources du PC.

## Utilisation avec FM27

- Mets FM en mode fenêtré ou fenêtré sans bordure.
- Clique **Fenêtres**, puis choisis Football Manager dans la liste.
- Clique **Capturer dans 5 s**, l’adjoint se réduit et tente de passer FM au premier plan automatiquement. Si Windows le refuse, clique dans FM pendant les cinq secondes. L'application photographie la région visible de cette fenêtre : une notification ou une fenêtre superposée peut apparaître dans la capture. Une fenêtre réduite ou inactive est refusée.
- Vérifie l'aperçu avant analyse. Tu peux aussi importer tes propres captures PNG/JPEG/WebP.
- Ajoute jusqu'à quatre captures : A, B, C, D dans cet ordre. Pour comparer deux joueurs, affiche leurs attributs respectifs et précise le poste souhaité dans la question.
- Choisis un nom de carrière et un type d'analyse, puis écris ta question.
- Clique **Demander à l'adjoint**. Attends la réponse sans fermer l'application.
- Consulte les rapports via **Historique**. **Exporter le rapport** crée un fichier texte.

Pour une tactique, fournis la formation, les rôles, les consignes avec ballon et sans ballon. Pour un débrief, ajoute les tirs, xG s'ils sont affichés, zones d'attaque et statistiques des joueurs. Pour analyser l'adversaire, ajoute ses écrans.

## Mémoire et limites

L'historique est conservé par nom de carrière dans `%LOCALAPPDATA%\FM27_Adjoint\historique.sqlite`. Les captures sont conservées seulement en mémoire dans cette application, pas dans la base. Ferme l'application puis supprime ce fichier pour effacer tout l'historique. Les 50 rapports les plus récents sont affichés ; la base conserve les précédents.

Ce logiciel lit des captures, pas la sauvegarde ou la mémoire du jeu. Il ne connaît pas les écrans jamais consultés, ne suit pas les déplacements en vidéo et ne modifie pas le jeu. Il n'effectue pas de surveillance continue. Aucun raccourci global ou overlay n'est inclus dans cette version. Les conseils sont générés par un modèle généraliste : les chiffres, intitulés et hypothèses doivent être vérifiés dans FM. Une instruction du modèle demande de signaler les incertitudes, mais ne garantit pas l'absence d'erreur.

## Vérification

Les tests automatisés couvrent les formats Gemini/Ollama avec réponses simulées, la séparation des carrières, la gestion de quota et les images. Exécuter :

```
.venv\Scripts\python.exe -m unittest discover -s tests -v
```

Le lancement Windows, la capture réelle de FM27 et les réponses en direct avec ta clé restent à tester sur ton PC. Aucun test en direct facturable n'a été exécuté.

Documentation : https://ai.google.dev/api/generate-content ; https://ai.google.dev/api/models ; https://docs.ollama.com/api

## Correction 1.1

Le bouton de capture réduit maintenant l’adjoint, restaure FM si nécessaire et demande à Windows de mettre le jeu au premier plan. L’adjoint réapparaît après la capture. Les captures ne sont jamais envoyées automatiquement. La sélection initiale du modèle privilégie désormais un modèle Flash standard lorsqu’il est présent, plutôt que le premier modèle de la liste. Douze tests automatisés passent, dont quatre tests des appels de capture Windows simulés. La capture réelle reste à vérifier sur Windows.

## Mise à jour automatique — version 1.2

Le lanceur vérifie au démarrage le manifeste update.json du dépôt public nonorigon-design/fm27-adjoint (branche main). La publication initiale de ce dépôt reste à effectuer : tant que le manifeste n'est pas disponible, l'application ouvre sa version incluse.

Les mises à jour contiennent app.py, core.py et capture.py. Elles sont vérifiées (empreintes SHA-256 et syntaxe Python), préparées dans un dossier distinct, puis lancées sans écraser la version précédente. Un échec du processus ramène à la précédente version installée. Sans réseau, la version installée reste disponible. Les dépendances et le lanceur lui-même ne sont pas remplacés par ce mécanisme : une modification future de ceux-ci peut nécessiter un nouveau paquet d'installation.

L'historique et la clé en mémoire ne sont pas envoyés à GitHub. GitHub reçoit la requête de vérification de mise à jour. Le dépôt ne doit contenir aucune clé API ni donnée de carrière. Dix-huit tests automatisés passent ; la publication et le test complet sur Windows restent à effectuer.
