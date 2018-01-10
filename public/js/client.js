socket.on('line', (data) => {
    var preline = $.map(data.split(' '), function(word) {
    	return $('<span>', { text: word + ' ' }).toggleClass('orange', word.match(/ok:/) != null)
                                        .toggleClass('green', word.match(/(changed|included):/) != null)[0];
    });
    var line = $('<div>', { class: 'log-line' }).append('<a>').append(preline);

    //wrapper
    line.toggleClass('green', data.match(/ok:/) != null);
    line.toggleClass('orange', data.match(/(changed|included):/) != null);
    line.toggleClass('red', data.match(/fatal:/) != null);
    line.toggleClass('blue', data.match(/(skipping:|...ignoring)/) != null);

    $('#code').append(line);

    //Then scroll to that line
    // see http://jsfiddle.net/7Lquu899/4/ for complete page scroll
    $('#code').animate({scrollTop: $('#code').prop("scrollHeight")}, 10);
});
