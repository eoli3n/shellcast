const express = require('express'),
      http = require('http'),
      app = express(),
      cons = require('consolidate'),
      fs = require('fs'),
      os = require('os'),
      util = require('util'),
      split = require('split'),
      spawn = require('child_process').spawn,
      exec = require('child_process').exec,
      server = http.createServer(app),
      subdir = "/" + process.env.SUBDIR,
      io = require('socket.io').listen(server, { path: subdir + '/socket.io' }),
      yaml = require('js-yaml'),
      ini = require('ini'),
      morgan = require('morgan'),
      path = require('path'),
      favicon = require('serve-favicon'),
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
    } else if (/[\s;&<>|()/\\!\*\$=+~]/.test(req.query[param])) {
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

    // Replace '{}' in the command with actual values from castArgs
    castArgs.forEach((arg, index) => {
      cmd = cmd.replace('{}', arg);  // Replace '{}' with the argument in cmd
    });

    // Execute the command
    exec(cmd, { maxBuffer: 1024 * 2000 }, (error, stdout, stderr) => {
      if (error) {
        console.error('Error executing command:', error);
        return res.status(500).send(`Error executing command: ${error.message}`);
      }
      if (stderr) {
        console.error('stderr:', stderr);
        return res.status(500).send(`stderr: ${stderr}`);
      }
      res.send(stdout);
    });
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

      // Replace '{}' in the command with actual values from castArgs
      castArgs.forEach((arg, index) => {
        cmdString = cmdString.replace('{}', arg);  // Replace '{}' with the argument in cmdString
      });

      const cmdList = cmdString.split(' ');
      const cmdFirst = cmdList.shift();

      // Execute the command
      const run = spawn(cmdFirst, cmdList);
      run.stdout.pipe(split()).on('data', (data) => {
        socket.emit('line', data.toString());
      });

      run.stderr.pipe(split()).on('data', (data) => {
        socket.emit('line', data.toString());
      });

      run.on('close', function (code) {
        console.log(`Cast ${url} exited with code ${code}`);
      });

      // Handle disconnection
      socket.on('disconnect', function () {
        run.kill('SIGHUP');
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
