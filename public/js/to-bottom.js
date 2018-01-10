$(".to-bottom").on("click", function() {
    $('#code').animate({scrollTop: $('#code').prop("scrollHeight")}, 200);
});
