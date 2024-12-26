const regexCache = new Map()

// Buffer pour l'affichage des lignes
const lineBuffer = []
let isProcessing = false
let finishedProcessing = false  // Indicateur pour la fin du processus

// Fonction de mise en cache des regex
const getRegex = (pattern) => {
    if (!regexCache.has(pattern)) {
        regexCache.set(pattern, new RegExp(pattern))
    }
    return regexCache.get(pattern)
}

// Optimisation de l'autoscroll avec requestAnimationFrame
let scrollTimeout
const smartScroll = () => {
    if (scrollTimeout) return
    
    scrollTimeout = requestAnimationFrame(() => {
        const html = document.documentElement
        html.scrollTop = html.scrollHeight
        scrollTimeout = null
    })
}

// Connexion socket
const locationSub = window.location.origin + window.location.search
const socket = io.connect(locationSub, {
    path: '/' + window.location.pathname.split('/')[1] + '/socket.io',
    transports: ['websocket'],
    upgrade: false
})

let jsonHighlight = []

// Initialisation
socket.emit('init', window.location.pathname)
socket.emit('focus')

// Réception de la configuration highlight
socket.on('highlight', (data) => {
    //console.log('Received highlight config:', data)
    jsonHighlight = data || []
    jsonHighlight.forEach(hl => {
        if (hl.word) getRegex(hl.word)
        if (hl.line) getRegex(hl.line)
    })
    
    socket.emit('run')
})

// Créer une ligne
const createSpan = (word) => {
    const span = document.createElement('span')
    span.textContent = word + ' '
    return span
}

// Application des highlights sur les mots ou les lignes
const applyHighlights = (element, text, isLine = false) => {
    //console.log(`Applying highlights to "${text}" (isLine: ${isLine})`)
    //console.log('Current jsonHighlight:', jsonHighlight)

    if (!jsonHighlight || jsonHighlight.length === 0) {
        console.warn('No highlight rules available')
        return
    }

    for (const hl of jsonHighlight) {
        if (!hl || (!hl.word && !hl.line)) continue
        
        const pattern = hl[isLine ? 'line' : 'word']
        if (pattern) {
            try {
                const regex = getRegex(pattern)
                if (regex.test(text)) {
                    element.classList.add(hl.class)
                    //console.log(`Applied highlight class ${hl.class} to: ${text}`)
                }
            } catch (error) {
                console.error(`Error applying highlight: ${error.message}`)
            }
        }
    }
}

// Créer une ligne complète avec les éléments
const createLine = (data) => {
    const lineDiv = document.createElement('div')
    lineDiv.className = 'log-line'
    
    // Ajout du lien vide pour la numérotation CSS
    const link = document.createElement('a')
    lineDiv.appendChild(link)
    
    // Traitement des mots et highlights
    const words = data.split(' ')
    for (const word of words) {
        const span = createSpan(word)
        applyHighlights(span, word, false)
        lineDiv.appendChild(span)
    }
    
    // Application des highlights de ligne
    applyHighlights(lineDiv, data, true)
    
    return lineDiv
}

// Dynamic batch size handling (removed slider & label)
let batchSize = 1; // Initial batch size (highly adjustable)
let lastProcessTime = 0;
let smoothedProcessTime;
const smoothingFactor = 0.02;
let linesProcessed = 0;
const MAX_BATCH_SIZE = 5000; // Limit for very large caches
let startTime; // init var

// Traitement des lignes optimisé
const processLines = () => {
    if (isProcessing) return
    isProcessing = true

    const processNextLines = () => {
        if (lineBuffer.length === 0) {
            if (finishedProcessing) {
                // Si nous avons fini et qu'il y a 2 lignes vides à la fin, on les retire
                if (lineBuffer[lineBuffer.length - 1]?.trim() === '' && 
                    lineBuffer[lineBuffer.length - 2]?.trim() === '') {
                    lineBuffer.pop() // Supprimer la dernière ligne vide
                    lineBuffer.pop() // Supprimer l'avant-dernière ligne vide
                }
            }
            isProcessing = false
            return
        }

        // Traiter un lot de lignes selon la taille du paquet
        const linesToProcess = lineBuffer.splice(0, batchSize)
        const fragment = document.createDocumentFragment()

        linesToProcess.forEach((line) => {
            if (line.trim().length === 0) return
            //console.log("Ligne à afficher: ", line)
            fragment.appendChild(createLine(line.trim()))
        })

        //console.log("Fragment ajouté au DOM")
        document.getElementById('code').appendChild(fragment)
        smartScroll()

        // Dynamically adjust batchSize based on processing time and line count
        const endTime = performance.now();
        const processTime = endTime - startTime;

        smoothedProcessTime =
            smoothedProcessTime * (1 - smoothingFactor) + processTime * smoothingFactor;

        // Ajustements plus agressifs
        if (smoothedProcessTime < 5) { // Seuils encore plus bas
            batchSize = Math.min(Math.round(batchSize * 2.5), MAX_BATCH_SIZE); // Augmentation plus rapide
        } else if (smoothedProcessTime > 25) { // Seuils encore plus bas
            batchSize = Math.max(Math.floor(batchSize / 2), 1);
        }

        // Ajustement initial plus rapide
        linesProcessed += linesToProcess.length;
        if (linesProcessed < 10) {
            batchSize = Math.min(25, MAX_BATCH_SIZE); // Ajustement rapide après les 10 premières lignes
        } else if (linesProcessed < 50) {
            batchSize = Math.min(100, MAX_BATCH_SIZE); // Ajustement plus important après 50 lignes
        } else if (linesProcessed < 1000 && batchSize < 500) {
            batchSize = Math.min(500, MAX_BATCH_SIZE);
        }

        if (lineBuffer.length > 0) {
            requestAnimationFrame(processNextLines) // Continuer à traiter si des lignes restent
        } else {
            isProcessing = false
        }
    }

    requestAnimationFrame(processNextLines) // Demander au navigateur de traiter les lignes
}

// Réception des lignes
socket.on('line', (data) => {
    lineBuffer.push(data)
    processLines() // Traiter les lignes dès qu'une nouvelle ligne est reçue
})

// Réception des lignes tamponnées
socket.on('lines', (lines) => {
    //console.log('Received buffered lines:', lines)
    //lines.forEach(line => lineBuffer.push(line))
    lineBuffer.push(...lines); // Use spread operator for efficient push
    processLines()
})

// Réception de la déconnexion
socket.on('disconnect', () => {
    finishedProcessing = true
    processLines() // Traiter les dernières lignes
})

// Déconnexion propre
window.addEventListener('beforeunload', () => {
    socket.close()
})

// Lorsque le processus est terminé, et si deux lignes vides sont présentes, les supprimer
socket.on('finished', () => {
    finishedProcessing = true
    batchSize = Math.min(lineBuffer.length, MAX_BATCH_SIZE); // Traite tout le cache d'un coup
    processLines()  // Réexécuter le traitement final pour enlever les lignes vides
})

// Fonction de mise à jour de l'auto-scroll
document.addEventListener("DOMContentLoaded", () => {
    const codeElement = document.getElementById("code")
    const autoScrollButton = document.getElementById("auto-scroll")
    const scrollToTopButton = document.getElementById("scroll-to-top")
    const scrollToBottomButton = document.getElementById("scroll-to-bottom")
    let autoScrollEnabled = true

    // Toggle auto-scroll
    autoScrollButton.addEventListener("click", () => {
        autoScrollEnabled = !autoScrollEnabled
        autoScrollButton.classList.toggle("active", autoScrollEnabled)
    })

    // Scroll to top
    scrollToTopButton.addEventListener("click", () => {
        codeElement.scrollTo({ top: 0, behavior: "smooth" })
    })

    // Scroll to bottom
    scrollToBottomButton.addEventListener("click", () => {
        codeElement.scrollTop = codeElement.scrollHeight
    })

    // Auto-scroll functionality
    const observer = new MutationObserver(() => {
        if (autoScrollEnabled) {
            codeElement.scrollTop = codeElement.scrollHeight
        }
    })

    observer.observe(codeElement, { childList: true, subtree: true })
})

// Gestion du focus et blur
let isFocused = true

// Focus sur le client : demander les lignes tamponnées au serveur
window.addEventListener('focus', () => {
    if (!isFocused) {
        isFocused = true
        socket.emit('focus') // Envoyer l'événement de focus au serveur
    }
})

// Perte de focus sur le client
window.addEventListener('blur', () => {
    if (isFocused) {
        isFocused = false
        socket.emit('blur') // Envoyer l'événement de blur au serveur
    }
})
