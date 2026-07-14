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

// Configure morgan logs
morgan.token("auth", (req) => {
    return req.authlog || "-";
});
morgan.token('status-text', (req, res) => {
    const status = res.statusCode;

    const messages = {
        200: 'OK',
        201: 'Created',
        204: 'No Content',
        400: 'Bad Request',
        401: 'Unauthorized',
        403: 'Forbidden',
        404: 'Not Found',
        500: 'Internal Server Error'
    };

    return messages[status] || 'Unknown';
});

app.use(morgan(':remote-addr - :auth [:date[clf]] ":method :url HTTP/:http-version" :status :status-text :response-time ms'));

// Load YAML config
let config;

try {
    config = yaml.safeLoad(fs.readFileSync(process.argv[2], 'utf8'));
} catch (error) {
    console.error('Error loading YAML config:', error);
    process.exit(1);
}

function loadUsers() {
    try {
        const users = yaml.safeLoad(fs.readFileSync("users.yml", "utf8"));

        if (!users || typeof users !== "object" || Array.isArray(users)) {
            throw new Error("users.yml must contain an object");
        }

        for (const [username, passwordHash] of Object.entries(users)) {
            if (typeof username !== "string" || typeof passwordHash !== "string") {
                throw new Error(`Invalid user entry: ${username}`);
            }
        }

        return users;

    } catch (error) {
        if (error.code === "ENOENT") {
            console.log("No users.yml found, local authentication disabled.");
            return {};
        }

        console.error("Unable to load users.yml:", error.message);
        process.exit(1);
    }
}

const users = loadUsers();
// DEBUG
//console.log(users);

const bcrypt = require("bcrypt");

function checkUser(username, password) {
    const storedHash = users[username];

    if (typeof storedHash !== "string") {
        return false;
    }

    return bcrypt.compareSync(password, storedHash);
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
const basicAuthShellcast = basicAuth({
    authorizer: checkUser,
    challenge: true,
    unauthorizedResponse: () => {
        return "Unauthorized";
    },
    realm: "shellcast"
});

// Middleware d'authentification
function authIfNeeded(service) {
    return (req, res, next) =>{

        // Si grant est absent du service
        if (!service.grant) {
            return next();
        }

        // Si x-remote-user est autorisé
        const remoteUser = req.headers["x-remote-user"];

        if (
            remoteUser &&
            Array.isArray(service.grant.x_remote_user) &&
            service.grant.x_remote_user.includes(remoteUser)
        ) {
            req.authlog = "x_remote_user=" + remoteUser;
            return next();
        }

        // Si x-group est autorisé
        const group = req.headers["x-group"];

        if (
            group &&
            Array.isArray(service.grant.x_group) &&
            service.grant.x_group.includes(group)
        ) {
            req.authlog = "x_group=" + group;
            return next();
        }

        // Si password est autorisé
        const password = req.query.password;

        if (
            typeof password === "string" &&
            Array.isArray(service.grant.password)
        ) {
            for (const entry of service.grant.password) {

                const [tag, hash] = Object.entries(entry)[0];

                if (bcrypt.compareSync(password, hash)) {
                    req.authlog = "password=" + tag;
                    return next();
                }
            }
        }

        // Si basic_auth activé via grant.local_user
        if (service.grant.local_user !== undefined) {

            // Si utilisateur authentifié
            return basicAuthShellcast(req, res, () => {

                req.authlog = "local_user=" + req.auth.user;

                // Si utilisateur authentifié autorisé sur le service
                if (service.grant.local_user.includes(req.auth.user)) {
                    return next();
                }

                return res.sendStatus(403);
            });
        }

        // Sinon erreur d'accès
        return res.sendStatus(401);
    }
}

// Handle HTTP requests
config.forEach((cast) => {
    cast.url = subdir + cast.url.replace(/\/$/, '');
    
    // Si mode web ou non défini, activer cette route
    if (cast.mode === undefined || cast.mode === "web") {
        app.get(cast.url, authIfNeeded(cast), (req, res) => {       
            // Renvoie la liste des paramètres incorrect au sein du service lancé et renvoie une erreur 400 côté client si la liste en contient au moins une 
            const errors = validateParams(cast.args || [], req, res, cast);
            if (errors.length > 0) {
                return res.status(400).send(errors.join('<br>'));
            }
            // Charge la page html où sera affiché les résultats de la commande
            res.setHeader('Content-Type', 'text/html');
            res.render('index', { title: cast.name, subdir: subdir });
        });
    }

    // Si mode plain ou non défini, activer cette route
    if (cast.mode === undefined || cast.mode === "plain") {
        app.get(cast.url + '/plain' ,authIfNeeded(cast) ,(req, res) => {
            res.setHeader('Content-Type', 'text/plain');
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
    }
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
