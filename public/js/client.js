//connect socket
var location_sub = window.location.origin + window.location.search
console.log(location_sub)
var socket = io.connect(location_sub, {
  path: window.location.pathname.split('/')[1] + '/socket.io'
})

//trigger run with cast url
socket.emit('init', window.location.pathname );

//get cast highlight
socket.on('highlight', (data) => {
    //catch empty highlight
    if (data){
        json_highlight = data
    } else {
        json_highlight = []
    }
    socket.emit('run')
});

//stream lines
socket.on('line', (data) => {

    //word highlight
    var preline = $.map(data.split(' '), function(word) {
        var a = $('<span>', { text: word + ' ' })
        json_highlight.forEach(function (hl){
            //debug
            //socket.emit('log', hl)
            if (hl['word']){
                if (word.match(RegExp(hl['word'])) != null) { a.addClass(hl['class']); }
                //debug
                //socket.emit('log', a.prop('outerHTML'))
            }
        })
        return a;
    });
 
    //add word highlited preline to line var
    var line = $('<div>', { class: 'log-line' }).append('<a>').append(preline);

    //line highlight
    json_highlight.forEach(function (hl){
        if (hl['line']){
            if (data.match(RegExp(hl['line'])) != null) { line.addClass(hl['class']); }
            //debug
            socket.emit('log', line.prop('outerHTML'))
        }
    })
    
    //add line to console
    $('#code').append(line);

    //Autoscroll
    $('html').animate({scrollTop: $('html').prop("scrollHeight")}, 10);
});
