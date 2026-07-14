const express = require('express'),
      http = require('http'),
      app = express(),
      cons = require('consolidate'),
      fs = require('fs'),
      os = require('os'),
      util = require('util'),
      split = require('split'),
      spawn = require('child_process').spawn,
      server = http.createServer(app),
      subdir = "/" + process.env.SUBDIR,
      { Server } = require('socket.io'),
      io = new Server(server , /*{ cors: { origin: "http://localhost:3000/shellcast/rainbow", credentials: true }},*/  { path: subdir + '/socket.io' }),
      yaml = require('js-yaml'),
      morgan = require('morgan'),
      path = require('path'),
      favicon = require('serve-favicon'),
      validator = require('validator'),
      basicAuth = require('express-basic-auth'),
      { exec } = require('child_process');

// Set trust proxy before adding any middleware or routes
app.set('trust proxy', true);

// Set up view engine and static resources
app.engine('html', cons.handlebars);
app.set('view engine', 'html');
app.set('views', __dirname + '/views/');
app.use(subdir, express.static(path.join(__dirname, '/public')));
app.use(favicon(path.join(__dirname, 'public', 'favicon.ico')));
app.use(morgan('combined'));

// Configure morgan logs

// TODO add fallback basic auth user
//morgan.token("user", (req) => req.headers["x-remote-user"] || basic_auth_user || "-");
// in logs : 127.0.0.1 - x_remote_user=krj9340a
// in logs : 127.0.0.1 - x_group=di
// in logs : 127.0.0.1 - local_user=toto

morgan.token("user", (req) => { return req.headers["x-remote-user"] || "-"});
morgan.token("group", (req) => { return req.headers["x-group"] || "-"});

app.use(morgan(':remote-addr - :user :group [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length]'));

// Load YAML config
let config;

try {
    config = yaml.safeLoad(fs.readFileSync(process.argv[2], 'utf8'));
} catch (error) {
    console.error('Error loading YAML config:', error);
    process.exit(1);
}


let noLocalUsers = false 
let usersShellcast;


try {
    let usersFile = yaml.safeLoad(fs.readFileSync("users.yml", 'utf8'))
    let users = usersFile["users"] !== undefined && usersFile["users"] !== null ?  usersFile["users"] :  []

    // Mise en format des utilisateurs pour le basic auth d'express
    let formatedUsers = {};

    for (user in users) {
        let key = users[user]["user"];
        let value = users[user]["password"];

        formatedUsers[key] = value;
    }

    usersShellcast = formatedUsers;
}
catch (error) {
   // console.error("Error : UserFile badly formated");
    if (error.code !== "ENOENT"){
        console.error("An error made the user.yml file unusable")
        process.exit(1);
    }
    console.log("No user file")
    noLocalUsers = true

    //process.exit(1);
}

function getUserAndGroups(url){
    app.get(url, (req, res) => {
        // 1. Récupérer tous les headers
        const tousLesHeaders = req.headers;
        console.log(tousLesHeaders);
    });
}

function checkUser(username, password) {
    let usersFile
    let userGroup

    let userNameCheck = Object.keys(usersShellcast).includes(username) ? username : 0
    let passwordCheck = usersShellcast[username] !== undefined ? usersShellcast[username] : 0

    try {
        const userMatches = basicAuth.safeCompare(username, userNameCheck)
        const passwordMatches = basicAuth.safeCompare(password, passwordCheck, 'custompassword')

        return userMatches & passwordMatches
    }
    catch(error){
        console.log("incorrect logins parameter")
    }
}

const forbiddenChars = ['>', '<', '|', '&', ';', '(', ')', '\\', '!', '*', '$', '=', '+', '~', '"', ' '];

// Fonction pour ajuster les caractères interdits selon la whitelist du service
const adjustForbiddenChars = (serviceConfig) => {
    // Si la whitelist est définie dans le service, on enlève ces caractères de la forbiddenChars
    if (serviceConfig.whitelist && Array.isArray(serviceConfig.whitelist)) {
        serviceConfig.whitelist.forEach(char => {
            const index = forbiddenChars.indexOf(char);
            if (index !== -1) {
                forbiddenChars.splice(index, 1); // Retirer le caractère de la forbiddenChars
            }
        });
    }
};

// Fonction pour trouver un caractère interdit dans un argument
const findForbiddenChar = (arg, serviceConfig) => {
    // On ajuste d'abord les forbiddenChars selon la whitelist du service
    adjustForbiddenChars(serviceConfig);

    // Cherche le premier caractère interdit dans l'argument et le retourne
    for (let char of forbiddenChars) {
        if (arg.includes(char)) {
            return char; // Retourne le premier caractère interdit trouvé
        }
    }
    return null; // Aucun caractère interdit trouvé
};

const validateParams = (params, req, res, serviceConfig) => {
    const errors = [];

    params.forEach(param => {
        const value = req.query[param];

        if (typeof value === 'undefined') {
            errors.push(`Missing "${param}" parameter`);
        } else {
            const forbiddenChar = findForbiddenChar(value, serviceConfig);
            if (forbiddenChar) {
                errors.push(`"${param}" contains forbidden character: "${forbiddenChar}"`);
            }
        }
    });

    return errors;
};

// Buffer for storing lines per client
const clientBuffers = new Map();

// Socket.io handling
io.sockets.on('connection', (socket) => {
    const clientId = socket.id;
    clientBuffers.set(clientId, []); // Initialize buffer for this client
    
    //console.log(`Client ${clientId} connected.`);

    socket.on('init', (url) => {
        let castArgs = [];
        let cmd = '';
        let castHighlightJson = [];
              
        
        // Find the cast corresponding to the URL
        const cast = config.find(c => c.url.replace(/\/$/, '') === url[0].replace(/\/$/, ''));
        
        if (cast) {
            cmd = cast.cmd;
            // Prepare arguments for the command
            if (cast.args) {
                castArgs = cast.args.map(arg => socket.handshake.query[arg]);
            }
            // Load highlights
            castHighlightJson = cast.highlight || [];
            // Send highlights to client
            socket.emit('highlight', castHighlightJson);

            if (cast.args && cast.args.length > 0) {
                castArgs.forEach((arg, index) => {
                    const placeholder = `{${cast.args[index]}}`;
                    cmd = cmd.split(placeholder).join(arg);
                });
            }

            // Add magic x_forwarded_for var
            if (cmd.includes("{x_forwarded_for}")) {
                let x_forwarded_for = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
                cmd = cmd.split("{x_forwarded_for}").join(x_forwarded_for);
                castArgs.push(x_forwarded_for);
            }

            // Add magic x_remote_user var
            if (cmd.includes("{x_remote_user}")) {
                let x_remote_user = socket.handshake.headers["x-remote-user"] || "unknown";
                cmd = cmd.split("{x_remote_user}").join(x_remote_user);
                castArgs.push(x_remote_user);
            }

            // Add magic x_group var
            if (cmd.includes("{x_group}")) {
                let x_group = socket.handshake.headers["x-group"] || "unknown";
                cmd = cmd.split("{x_group}").join(x_group);
                castArgs.push(x_group);
            }

            const startTime = Date.now();

            const run = spawn('bash', ['-c', cmd]);

            run.stdout.pipe(split()).on('data', (data) => {
                const line = data.toString();
                //console.log('Line from stdout:', line);

                if (!socket.focus) {
                    //console.log(`Buffering line for ${clientId}:`, line);
                    clientBuffers.get(clientId).push(line);
                } else {
                    //console.log(`Sending line to ${clientId}:`, line);
                    socket.emit('line', line);
                }
            });

            run.stderr.pipe(split()).on('data', (data) => {
                const line = data.toString();
                //console.log('Line from stderr:', line);

                if (!socket.focus) {
                    //console.log(`Buffering stderr line for ${clientId}:`, line);
                    clientBuffers.get(clientId).push(line);
                } else {
                    //console.log(`Sending stderr line to ${clientId}:`, line);
                    socket.emit('line', line);
                }
            });

            run.on('close', (code) => {

                const endTime = Date.now();
                const executionTimeInSeconds = (endTime - startTime) / 1000;
                const hours = Math.floor(executionTimeInSeconds / 3600);
                const minutes = Math.floor((executionTimeInSeconds % 3600) / 60);
                const seconds = Math.floor(executionTimeInSeconds % 60);
                const milliseconds = Math.round((executionTimeInSeconds % 1) * 1000);

                let executionTime = '';

                if (hours > 0) {
                    executionTime += `${hours}h `;
                }
                if (minutes > 0) {
                    executionTime += `${minutes}m `;
                }

                if (executionTimeInSeconds < 1) {
                    executionTime += `${milliseconds}ms`;
                } else {
                    executionTime += `${seconds}s`;
                }

                let ANSI_COLOR_RED = '\x1b[38;5;9m';  // Rouge
                let ANSI_COLOR_GREEN = '\x1b[38;5;10m'; // Vert
                let ANSI_RESET = '\x1b[0m';
                let ANSI_GRAY_ITALIC = '\x1b[38;5;8m\x1b[3m'; // Gris italique
                let ANSI_WHITE_ITALIC = '\x1b[97m\x1b[3m'; // Blanc italique
                let icon = (code !== 0) ? `${ANSI_COLOR_RED}✘${ANSI_RESET}` : `${ANSI_COLOR_GREEN}✔${ANSI_RESET}`;
                let line = `${icon} ${ANSI_WHITE_ITALIC}Command exited with code ${code} in ${executionTime}.${ANSI_RESET}`;
                if (!socket.focus) {
                    //console.log(`Buffering stderr line for ${clientId}:`, line);
                    clientBuffers.get(clientId).push(line);
                } else {
                    //console.log(`Sending stderr line to ${clientId}:`, line);
                    socket.emit('line', line);
                }
                console.log(`Command ${cmd} exited with code ${code}`);
            });

            socket.on('disconnect', () => {
                //console.log(`Client ${clientId} disconnected.`);
                if (run) run.kill('SIGTERM');
                clientBuffers.delete(clientId);
            });
        } else {
            socket.emit('line', 'Error: Cast not found for URL');
        }
    });

    socket.on('focus', () => {
        //console.log(`Client ${clientId} is now focused.`);
        const buffer = clientBuffers.get(clientId) || [];
        if (buffer.length > 0) {
            //console.log(`Sending buffered lines to ${clientId}:`, buffer);
            socket.emit('lines', buffer); // Send buffered lines to the client
            clientBuffers.set(clientId, []); // Clear buffer after sending
        }
        socket.focus = true;
    });

    socket.on('blur', () => {
        //console.log(`Client ${clientId} is now blurred.`);
        socket.focus = false;
    });
});

// BasicAuth permettant aux utilisateurs locaux de se connecter
const basicAuthShellcast = basicAuth({users : usersShellcast, authorizer : checkUser, challenge : true,  realm: 'shellcast'})

// Middleware permettant d'appliquer ou non le middleware sous certaines conditions et prenant en paramètre les données sotckées dans la variable cast
function authIfNeeded(castData) {
    return (req, res, next) =>{
        // Récupération des users et du groupe passés en headers dans l'URL
        const userId = req.headers["x-remote-user"];
        const group = req.headers["x-group"];

        console.log(castData)

        // Récupération des users et groupes autorisés
        let configUsers = castData;
        let authorizedUsers = Object.keys(configUsers).includes("grant") && configUsers["grant"] !== null ? configUsers["grant"] : {};


        //console.log(usersShellcast)
       // console.log(authorizedUsers)

        let localUsersShellcast = usersShellcast !== undefined && Object.keys(usersShellcast).length > 0 ? new Set(Object.keys(usersShellcast)) : new Set([])
        let localUsersGrant =  authorizedUsers["local_user"] !== undefined &&  authorizedUsers["local_user"] !== null ? new Set(authorizedUsers["local_user"]) :new Set([])
        
        //console.log(localUsersShellcast)
        //console.log(localUsersGrant)
        
        //let unknownLocalUsers =  localUsersGrant.filter(user => !localUsersShellcast.includes(user))
        let unknownLocalUsers = localUsersShellcast.intersection(localUsersGrant)
        console.log(unknownLocalUsers)

        // Si Il y a des local_user autorisés dans le service mais inexistants dans users.yml
        if (unknownLocalUsers.size > 0){
            // Alors prévenir l'utilisateur
            console.warn("Warning : some users are not locally registered : " + unknownLocalUsers.toString())
            //process.exit(1)
        }

        // Teste si il y a des utilisateurs définis dans users.yml
        let locUsersPresent = noLocalUsers === false && usersShellcast !== undefined && Object.keys(usersShellcast).length !== 0
        // Tester si l'utilisateur est un x-remote-user ou un x-group autorisé dans le service
        let notspecialUsers = (authorizedUsers["x_remote_user"] !== undefined && !authorizedUsers["x_remote_user"].includes(userId)) && (!authorizedUsers["x_group"] !== undefined && !authorizedUsers["x_group"].includes(group))
        //console.log(notspecialUsers)
        //console.log(unknownLocalUsers)
       // console.log(not)

       console.log(userId)
       console.log(group)

        // Activation de l'authentification dès que grant est défini
        if (Object.keys(authorizedUsers).length === 0 && configUsers["grant"] === null){ 

            // Authentification x-remote-user et x-group 
             if (userId !== undefined || group !== undefined){
               console.warn("Unknown Special user")
               return res.sendStatus(401)
            }

            // Sinon authentification basicauth
            else if (usersShellcast !== undefined && Object.keys(usersShellcast).length === 0){
                console.log("ici")
                return basicAuthShellcast(req, res, next); 
            }
           
            else{
                console.warn("Warning : some users are not locally registered : " + unknownLocalUsers.toString() + " access locked")
                return res.sendStatus(401)
            }
           
        }
        else if (notspecialUsers){


            if (userId !== undefined || group !== undefined){
               console.warn("Unknown Special user")
               return res.sendStatus(401)
            }
            else if (locUsersPresent && Object.keys(authorizedUsers).length > 0){
                return basicAuthShellcast(req, res, next); 

            }
            
            console.log("ici")
            //return res.sendStatus(401)
            //return basicAuthShellcast(req, res, next); 
        }
        // On applique le basicauth si l'userId n'est pas contenu dans le config YML ou si le groupe n'est pas autorisé

        // Si l'URL de CURL contient comme paramètre un user ou un groupe autorisé
        // on passe à la suite sans passer par le basic auth
        return next();
    }
}

// Handle HTTP requests
config.forEach((cast) => {
    cast.url = subdir + cast.url.replace(/\/$/, '');
    
    app.get(cast.url, authIfNeeded(cast), (req, res) => {       
        // Gère si le mdp du service shellcast est le même que celui passé dans les headers de l'url
        if (cast.password && cast.password !== req.query.password) {
            return res.status(403).send('Missing or wrong password...');
        }
        // Renvoie la liste des paramètres incorrect au sein du service lancé et renvoie une erreur 400 côté client si la liste en contient au moins une 
        const errors = validateParams(cast.args || [], req, res, cast);
        if (errors.length > 0) {
            return res.status(400).send(errors.join('<br>'));
        }
        // Charge la page html où sera affiché les résultats de la commande
        res.setHeader('Content-Type', 'text/html');
        res.render('index', { title: cast.name, subdir: subdir });
    });

    app.get(cast.url + '/plain' ,authIfNeeded(cast) ,(req, res) => {
        res.setHeader('Content-Type', 'text/plain');
        // TODO basic auth
        // Gère si le mdp du service shellcast est le même que celui passé dans les headers de l'url
        if (cast.password && cast.password !== req.query.password) {
            return res.status(403).send('Incorrect or missing password...');
        }
        // Renvoie la liste des paramètres incorrect et renvoie une erreur 400 côté client si la liste en contient au moins une 
        const errors = validateParams(cast.args || [], req, res, cast);
        if (errors.length > 0) {
            return res.status(400).send(errors.join('<br>'));
        }

        let cmd = cast.cmd;
        const castArgs = cast.args ? cast.args.map(arg => req.query[arg]) : [];

        //console.log("castArgs : " + castArgs)
        
        if (cast.args && cast.args.length > 0) {
            castArgs.forEach((arg, index) => {
                const placeholder = `{${cast.args[index]}}`;
                cmd = cmd.split(placeholder).join(arg);
            });
        }

        // Add magic x_forwarded_for var
        if (cmd.includes("{x_forwarded_for}")) {
            let x_forwarded_for = req.ip;
            cmd = cmd.split("{x_forwarded_for}").join(x_forwarded_for);
            castArgs.push(x_forwarded_for);
        }
        // Permet d'exécuter des commandes produisant beaucoup de données
        // et d'intéragir avec les sorties std
        const run = spawn('bash', ['-c', cmd]);
        // On exécute la commande sur stdout et stderr
        run.stdout.pipe(res);
        run.stderr.pipe(res);
        
        run.on('error', (error) => {
            console.error('Error spawning process:', error);
            res.status(500).send(`Error spawning process: ${error.message}`);
        });
        
        run.on('close', (code) => {
            console.log(`Command ${cmd} exited with code ${code}`);
        });
    });
});

// Handle 404 errors
app.use((req, res) => {
    res.setHeader('Content-Type', 'text/plain');
    res.status(404).send('Page Not Found...');
});

// Start the server and listen only ipv4
server.listen(process.env.NODE_PORT, '0.0.0.0', () => {
    console.log('Server listening on *:' + process.env.NODE_PORT);
});
