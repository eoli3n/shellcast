var express = require('express')
  , app = express()
  , cons = require('consolidate')
  , fs = require('fs')
  , os = require('os')
  , util = require('util')
  , split = require('split')
  , spawn = require('child_process').spawn
  , exec = require('child_process').exec
  , server = require('http').Server(app)
  , io = require('socket.io')(server, {
    cookie: false
  })
  , yaml = require('js-yaml')
  , ini = require('ini')
  , morgan = require('morgan')
  , path= require('path')
  , favicon = require('serve-favicon')

// assign the handlebars engine to .html files
app.engine('html', cons.handlebars)

// set .html as the default extension
app.set('view engine', 'html')
app.set('views', __dirname + '/views/')

// declare static ressources
app.use(express.static(__dirname + '/public'))

// serve favicon
app.use(favicon(path.join(__dirname, 'public', 'favicon.ico')))

// morgan logs
app.use(morgan('combined'))

// read yml config file
var config = yaml.safeLoad(fs.readFileSync(process.argv[2], 'utf8'));

// when query url
config.forEach(function (cast){
    //remove last '/' fix
    app.get( cast.url.replace(/\/$/, '') , function(req, res) {
    
        // if password set, test it
        if ((cast.password) && (cast.password != req.query.password)) {
            res.status(404).send('<span>Missing or wrong password...</span>')
        } else {
            //test args
            if (cast.args){
                cast.args.forEach(function (arg){
                    if (typeof req.query[arg] === 'undefined'){
                        res.status(404).send('<span>Missing "' + arg + '" parameter</span>')
                    }
                })
            }

            // render html
            res.render('index', { title: cast.name })
        }
    })

    // when query url /plain
    app.get( cast.url.replace(/\/$/, '') + '/plain' , function(req, res) {
        if ((cast.password) && (cast.password != req.query.password)) {
            res.status(404).send('Missing or wrong password...')
        } else {
            //test and set args
            if (cast.args){
                cast_args = []
                cast.args.forEach(function (arg){
                    if (typeof req.query[arg] === 'undefined'){
                        res.status(404).send('Missing "' + arg + '" parameter')
                    } else {
                        cast_args.push(req.query[arg])
                    }
                })
                //substitute '{}' with args
                var new_cmd_string = cast.cmd.replace(/\{\}/g, '%s');
                var cmd = util.format(new_cmd_string, ...cast_args);
                console.log(cmd)
            } else {
                var cmd = cast.cmd
            }

            //run
            exec(cmd, {maxBuffer: 1024 * 2000}, function(error, stdout, stderr) {
                res.setHeader('Content-Type', 'text/plain')
                res.send(stdout)
            })
        } 
    })
})

io.sockets.on('connection', function (socket) {
    console.log('Socket connected.')
    //console.log(socket.handshake.query)

    //debug
    //socket.on('log', function(data){
    //    console.log(data)
    //})

    socket.on('init', function (url) {
        //console.log('url: ' + url)

        //match yml and client url
        config.forEach(function (cast){
            //remove last '/' fix
            if (cast.url.replace(/\/$/, '') == url.replace(/\/$/, '')){
                // get string cmd
                cmd_string = cast.cmd
                // get args
                cast_args = []
                if (cast.args){
                    cast.args.forEach(function (arg){
                        cast_args.push(socket.handshake.query[arg])
                    })
                }
                // get highlight to json
                if (cast.highlight){
                    cast_highlight_json = cast.highlight
                } else {
                    cast_highlight_json = []
                }
            }
        })
    
        //send json highlight -> client
        socket.emit('highlight', cast_highlight_json)

        //replace vars
        if (cast_args){
            //substitute '{}' with args
            var new_cmd_string = cmd_string.replace(/\{\}/g, '%s');
            var cmd = util.format(new_cmd_string, ...cast_args);
        }

        //format to spawn dict
        var cmd_list = cmd.split(' ')
        var cmd_first = cmd_list[0]
        cmd_list.shift()
    
        //run
        socket.on('run', function () {
            run = spawn(cmd_first, cmd_list)
            //on new data
            //stdout
            run.stdout.pipe(split()).on('data', (data) => {
                line = `${data}`
                //console.log(line)
                socket.emit('line', line)
            })
    
            //stderr
            run.stderr.pipe(split()).on('data', (data) => {
                line = `${data}`
                //console.log(line)
                socket.emit('line', line)
            })
    
            //on close
            run.on('close', function (code) {
                console.log( 'Cast ' + url + ' exited with code ' + code)
            })
        })
    
        //on disconnect
        socket.on('disconnect', function() {
            run.kill('SIGHUP')
        })
    })
})

app.use(function(req, res, next){
    res.setHeader('Content-Type', 'text/html')
    res.status(404).send('<span>Page Introuvable...</span>')
})

server.listen(8080)
