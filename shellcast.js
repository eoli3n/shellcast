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
      { Server } = require('socket.io'),  // Utilisation du constructeur Server
      io = new Server(server, { path: subdir + '/socket.io' }),  // Instanciation avec Server
      yaml = require('js-yaml'),
      morgan = require('morgan'),
      path = require('path'),
      favicon = require('serve-favicon'),
      shellEscape = require('shell-escape'),
      validator = require('validator'); // Pour validation des paramètres

// Set subdir

// Assign the handlebars engine to .html files
app.engine('html', cons.handlebars);

// Set .html as the default extension
app.set('view engine', 'html');
app.set('views', __dirname + '/views/');

// Declare static resources in subdir
app.use(subdir, express.static(path.join(__dirname, '/public')));

// Serve favicon
app.use(favicon(path.join(__dirname, 'public', 'favicon.ico')));

// morgan logs
app.use(morgan('combined'));

// Read YAML config file
let config;
try {
  config = yaml.safeLoad(fs.readFileSync(process.argv[2], 'utf8'));
} catch (error) {
  console.error('Error loading YAML config:', error);
  process.exit(1); // Exit if config can't be loaded
}

// Validate parameters function
const validateParams = (params, req, res) => {
  const errors = [];
  params.forEach(param => {
    // Check if a parameter is missing
    if (typeof req.query[param] === 'undefined') {
      errors.push(`Missing "${param}" parameter`);
    } else if (/[\;&<>|()/\\!*\$=+~]/.test(req.query[param])) {
      // Check if the parameter contains dangerous special characters
      errors.push(`"${param}" cannot contain special characters`);
    }
  });
  return errors;
};

// When query URL
config.forEach(function (cast) {

  // Prepend subdir and remove last '/' fix
  cast.url = subdir + cast.url.replace(/\/$/, '');

  app.get(cast.url, function (req, res) {
    // Set header for all answers
    res.setHeader('Content-Type', 'text/plain');
    
    // If password is set, test it
    if (cast.password && cast.password !== req.query.password) {
      return res.status(403).send('Missing or wrong password...');
    }

    // Validate parameters
    const errors = validateParams(cast.args || [], req, res);
    if (errors.length > 0) {
      return res.status(400).send(errors.join('<br>')); // Return detailed error message
    }

    // If everything is valid, send back the HTML page
    res.setHeader('Content-Type', 'text/html');
    res.render('index', {
      title: cast.name,
      subdir: subdir
    });
  });

  // When query URL /plain
  app.get(cast.url + '/plain', function (req, res) {
    // Set header for all answers
    res.setHeader('Content-Type', 'text/plain');

    // Password verification
    if (cast.password && cast.password !== req.query.password) {
      return res.status(403).send('Incorrect or missing password...');
    }

    // Validate parameters
    const errors = validateParams(cast.args || [], req, res);
    if (errors.length > 0) {
      return res.status(400).send(errors.join('<br>')); // Return detailed error message
    }

    // Build the command with arguments
    let cmd = cast.cmd;
    const castArgs = cast.args ? cast.args.map(arg => req.query[arg]) : [];

    // Escape all arguments using shell-escape and remove single quotes
    let escapedArgs = castArgs.map(arg => shellEscape([arg]));
    escapedArgs = escapedArgs.map(arg => arg.replace(/^'(.*)'$/, '$1')).join(' ');  // Remove surrounding single quotes

    // Replace the arguments in the command
    escapedArgs.split(' ').forEach((escapedArg, index) => {
      const placeholder = `{${cast.args[index]}}`; // Match the argument placeholder (e.g., {hostname}, {ip}, etc.)
      cmd = cmd.split(placeholder).join(escapedArg);  // Replace all instances of the placeholder with the actual escaped argument value
    });

    // Log the final command for debugging
    //console.log('Final command:', cmd);

    // Execute the command using spawn
    const cmdList = cmd.split(' ');
    const cmdFirst = cmdList.shift(); // Extract the first part of the command (e.g., script path)

    // Ensure the script path is correct and doesn't include placeholders
    const run = spawn(cmdFirst, cmdList);

    // Pipe the output of the command to the response
    run.stdout.pipe(res);
    run.stderr.pipe(res);

    // Handle errors
    run.on('error', (error) => {
      console.error('Error spawning process:', error);
      res.status(500).send(`Error spawning process: ${error.message}`);
    });

    // Handle process exit
    //run.on('close', function (code) {
    //  console.log(`Cast ${cast.url} exited with code ${code}`);
    //});
  });
});

// Socket.io handling
io.sockets.on('connection', function (socket) {
  socket.on('init', function (url) {
    let castArgs = [];
    let cmdString = '';
    let castHighlightJson = [];

    // Find the cast corresponding to the URL
    const cast = config.find(c => c.url.replace(/\/$/, '') === url.replace(/\/$/, ''));
    if (cast) {
      cmdString = cast.cmd;

      // Prepare arguments for the command
      if (cast.args) {
        castArgs = cast.args.map(arg => socket.handshake.query[arg]);
      }

      // Load highlights
      castHighlightJson = cast.highlight || [];

      // Send highlights to client
      socket.emit('highlight', castHighlightJson);

      // Escape all arguments without adding quotes
      const escapedArgs = castArgs.map(arg => shellEscape([arg])).map(arg => arg.replace(/^'(.*)'$/, '$1'));

      // Replace the arguments in the command
      escapedArgs.forEach((escapedArg, index) => {
        const placeholder = `{${cast.args[index]}}`; // Match the argument placeholder (e.g., {hostname}, {ip}, etc.)
        cmdString = cmdString.split(placeholder).join(escapedArg);  // Replace all instances of the placeholder with the actual escaped argument value
      });

      const cmdList = cmdString.split(' ');
      const cmdFirst = cmdList.shift(); // Extract the first part of the command (e.g., script path)

      // Log the final command for debugging
      //console.log('Final command:', cmdString);

      // Execute the command using spawn
      const run = spawn(cmdFirst, cmdList);
      run.stdout.pipe(split()).on('data', (data) => {
        socket.emit('line', data.toString());
      });

      run.stderr.pipe(split()).on('data', (data) => {
        socket.emit('line', data.toString());
      });

      //run.on('close', function (code) {
      //  console.log(`Cast ${url} exited with code ${code}`);
      //});

      // Handle disconnection
      socket.on('disconnect', function () {
        if (run) run.kill('SIGTERM');
      });
    } else {
      socket.emit('line', 'Error: Cast not found for URL');
    }
  });
});

// Handle 404 errors
app.use(function (req, res, next) {
  res.setHeader('Content-Type', 'text/plain');
  res.status(404).send('<span>Page Not Found...</span>');
});

// Start the server
server.listen(process.env.NODE_PORT, () => {
  console.log('Server listening on *:' + process.env.NODE_PORT);
});
