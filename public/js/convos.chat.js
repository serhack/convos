;(function($) {
  window.link_embedder_text_gist_github_styled = 1; // custom gist styling

  var $input, $win;
  var $messages = $('<div/>'); // need to be defined
  var nicks = new sortedSet();
  var conversation_list = [];
  var min_width = 700;
  var commands = [
    '/help',
    '/join #',
    '/query ',
    '/msg ',
    '/me ',
    '/say ',
    '/nick ',
    '/close',
    '/part ',
    '/names ',
    '/mode ',
    '/topic ',
    '/reconnect',
    '/whois ',
    '/list'
  ];

  window.convos = {
    conversation_list: conversation_list,
    messages: $messages,
    nicks: nicks
  };

  $.fn.attachEventsToMessage = function() {
    return this.each(function() {
      var $message = $(this);

      $message.find('h3 a').click(function(e) {
        e.preventDefault();
        if($(this).hasClass('goto-network')) {
          $.pjax.click(e, { container: $('div.messages') });
        }
        else {
          var n = $(this).text();
          $input.val($input.val() ? $input.val().replace(/\s+$/, '') + ' ' + n + ' ' : n + ': ').focus();
        }
      });

      // embed media
      $message.find('a.embed').each(function() {
        var $a = $(this);
        $.get($.url_for('/oembed'), { url: this.href }, function(embed_code) {
          var at_bottom = $win.atBottom();
          var $embed_code = $(embed_code);
          $a.closest('div').after($embed_code);
          if(at_bottom) {
            $win.scrollTo('bottom');
            $embed_code.find('img').one('load', function() { $win.scrollTo('bottom') });
          }
        });
      });

      $message.find('.close').click(function() { $(this).closest('li').remove(); });
      $message.filter('.historic-message').find('a.button.newer').click(getNewMessages);
      $message.filter('.historic-message').find('a.button.current').click(function(e) {
        return $.pjax.click(e, { container: 'div.messages' });
      });
    });
  };

  $.fn.appendToMessages = function() {
    var $previous = $messages.children('li').not('.message-pending').eq(-1);
    var last_nick = $previous.data('sender') || '';

    this.attachEventsToMessage();

    if(this.hasClass('message') && $previous.hasClass('message')) {
      if(last_nick == this.data('sender')) {
        this.addClass('same-nick').children('h3, .avatar, .timestamp').remove();
      }
    }
    else if(this.hasClass('nick-change')) {
      var new_nick = this.find('.nick').text();
      var old_nick = this.find('.old').text();
      var old_score = nicks.score(old_nick);
      var re, txt;

      console.log('new_nick=' + new_nick + ', old_nick=' + old_nick + ', old_score=' + old_score);

      if(old_nick == $messages.data('nick')) {
        re = new RegExp('\\b' + old_nick + '\\b', 'i');
        txt = $input.attr('placeholder').replace(re, new_nick);
        $input.attr('placeholder', txt);
        $messages.data('nick', new_nick);
      }
      if(typeof old_score == 'undefined') {
        return; // do not want to show joined when in other channel
      }
      else {
        nicks.add(old_score, new_nick).rem(old_nick);
        nickList($('<div/>'));
      }
    }
    else if(this.hasClass('nick-joined')) {
      nicks.add(0, this.find('.nick').text());
      nickList($('<div/>'));
    }
    else if(this.hasClass('nick-parted')) {
      nicks.rem(this.find('.nick').text());
      nickList($('<div/>'));
    }
    else if(this.hasClass('nick-quit')) {
      var nick = this.find('.nick').text();
      if(nicks.score(nick)) {
        nicks.rem(nick);
        nickList($('<div/>'));
      }
      else {
        return;
      }
    }
    else if(this.hasClass('nicks')) {
      nickList(this);
      return;
    }
    else if(this.data('sender') && this.data('sender') != $messages.data('nick')) {
      nicks.add(new Date().getTime(), this.data('sender'));
    }

    $messages.append(this.fadeIn('fast'));
  };

  $.fn.hostAndTarget = function($from) {
    if($from) {
      return this
        .attr('data-network', $from.data('network')).attr('data-target', $from.data('target'))
        .data('network', $from.data('network')).data('target', $from.data('target'))
    }
    else {
      return { network: this.data('network'), target: this.data('target') };
    }
  };

  var conversationLoaded = function(e, data, status_text, xhr, options) {
    var $doc = $(data || '<div></div>');
    var menu_width = $('nav .right').outerWidth();

    $messages = $('div.messages ul');
    $messages.end_time = parseFloat($messages.data('end-time') || 0);
    $messages.start_time = parseFloat($messages.data('start-time') || 0);

    $('body').attr('class', $messages.attr('class')).loadingIndicator('hide');
    $messages.find('li').attachEventsToMessage();
    nicks.clear();

    $('form.sidebar button.ws-cmd').each(function() {
      $(this).removeClass('ws-cmd').click(function(e) {
        e.preventDefault();
        $input.send(this.value);
      });
    });

    $doc.filter('form.sidebar').each(function() {
      $('form.sidebar ul').html($(this).find('ul:first').children());
    });
    $doc.filter('nav').each(function() {
      $('nav ul.conversations').html($(this).find('ul.conversations').children());
      drawConversationMenu();
    });

    if (/^[#&]/.test($messages.hostAndTarget().target)) {
      $input.send('/names');
    }

    if(location.href.indexOf('from=') > 0) { // link from notification list
      $win.scrollTo(0);
      getHistoricMessages();
    }

    if(!navigator.is_ios) $input.focus();
    $input.hostAndTarget($messages);
    drawSettings();

    $('nav ul.conversations a').each(function() { menu_width += $(this).outerWidth(); });
    $('nav').data('menu_width', menu_width);

    drawUI();
    $input.data('socket').send('PING'); // open socket
  };

  var drawConversationMenu = function($message) {
    var $conversations = $('nav ul.conversations li');
    var s = $('form.conversations select')[0].selectize;

    if($message) {
      $a = $conversations.find('a[href="' + $.url_for($message.data('network'), $message.data('target')) + '"]');
      unread = parseInt($a.children('b').html() || 0) + 1;
      $a.children('b').text(unread ? unread : '');
    }

    s.clearOptions();
    $conversations.map(function() {
      var $a = $(this).find('a');
      var i = { label: $a.find('span').text() };
      if(!i.label) return;
      if(i.label == $messages.attr('data-target')) return;
      i.href = $a.attr('href');
      i.unread = $(this).find('b').text();
      i.network = $a.attr('title').replace(/\w+:\s+/, '');
      s.addOption(i);
    });
    s.refreshOptions(false);
  };

  var drawSettings = function() {
    var channels = {};
    var networkChange;

    $('select#name option').each(function() {
      channels[this.value] = ($(this).attr('data-channels') || '').split(' ');
    });

    networkChange = function(val) {
      var s = $('select#channels')[0].selectize
      s.clearOptions();
      s.addOption($.map(channels[val], function(i) { return { value: i, text: i,  }; }));
      s.refreshOptions(false);
      s.setValue(channels[val].join(' '));
    };

    $('select#name').selectize({
      create: false,
      openOnFocus: true,
      onChange: networkChange
    }).trigger('change');

    $('input#channels').selectize({
      delimiter: ' ',
      persist: false,
      openOnFocus: true,
      create: function(value) {
        if(!/^[#&]/.test(value)) value = '#' + value;
        return { value: value, text: value };
      }
    });
  };

  var drawUI = function(e) {
    if(!e) $win.scrollTo('bottom');

    if($('nav').data('menu_width') > $('body').outerWidth()) {
      $('nav a.conversations').addClass('overlapping');
    }
    else {
      $('nav a.conversations').removeClass('overlapping');
    }
  };

  var getHistoricMessages = function() {
    if($messages.start_time && $win.scrollTop() == 0) {
      var end_time = $messages.end_time;
      $.get(location.href.replace(/\?.*/, ''), { to: $messages.start_time }, function(data) {
        var $ul = $(data).find('ul[data-network]');
        var $li = $ul.children('li:lt(-1)');
        var height_before_prepend = $('body').height();
        $messages.end_time = end_time;
        if(!$li.length) return;
        $messages.start_time = parseFloat($ul.data('start-time'));
        $messages.prepend($li.attachEventsToMessage());
        $win.scrollTop($('body').height() - height_before_prepend);
      });
      $messages.start_time = $messages.end_time = 0;
    }

    return false;
  };

  var getNewMessages = function(e) {
    var $btn = $(this);
    var start_time = $messages.start_time;
    if(!e.silent) {
      $('body').loadingIndicator('show');
    }
    if($messages.end_time) {
      $.get(location.href.replace(/\?.*/, ''), { from: $messages.end_time }, function(data) {
        var $ul = $(data);
        var $li = $ul.children('li:gt(0)');
        if(!e.silent) $('body').loadingIndicator('hide');
        $btn.closest('li').remove();
        $messages.start_time = start_time;
        if(!$li.length) return;
        $messages.end_time = parseFloat($ul.data('end-time'));
        $li.each(function() { $(this).appendToMessages(); });
        if(!$li.filter('.historic-message').length) drawUI();
      });
    }
    $messages.start_time = $messages.end_time = 0;
    return false;
  };

  var initConversations = function() {
    $('form.add-conversation button[type="reset"]').click(function() { $('a.btn-sidebar.active').click(); });
    $('form.add-conversation').submit(function(e) {
      e.preventDefault();

      var $form = $(this);
      var network = $form.find('select[name="name"]').val();
      var channel = $form.find('input[name="channel"]').val().replace(/^\s*#/, '');

      if(channel) {
        $input.send('/join #' + channel, { 'data-network': network, pending_status: true });
        $('a.btn-sidebar.active').click();
      }
    });

    $('form.conversations select').selectize({
      labelField: 'label',
      maxOptions: 10000,
      openOnFocus: true,
      options: [],
      placeholder: 'Select or create a new conversation',
      searchField: [ 'label' ],
      valueField: 'href',
      create: function(value) {
        if(value.match(/^[#&]/)) {
          $('nav a.add-conversation').click();
          $('form.add-conversation input[name="channel"]').val(value);
        }
        else {
          $input.send('/query ' + value, { pending_status: true });
        }
        return false;
      },
      onChange: function(href) {
        $('nav a[href="' + href + '"]').click();
      },
      onInitialize: function() {
        this.$dropdown.hide = function() {};
      },
      render: {
        option: function(item, esc) {
          var n = '<small>on ' + esc(item.network) + '</small>';
          var unread = '<b>' + esc(item.unread) + '</b>';
          return '<a>' + [esc(item.label), n, unread].join(' ') + '</a>';
        },
        option_create: function(data, esc) {
          var pre = data.input.match(/^[#&]/) ? 'Join channel' : 'Chat with';
          return '<a class="create">' + pre + ' <strong>' + esc(data.input) + '</strong>.</a>';
        }
      }
    });
  };

  var initInputField = function() {
    var current = '';
    var complete, val, offset, re;

    var autocomplete = function(e) {
      var val = $input.val();
      var offset = val.lastIndexOf(' ') + 1;
      var re = new RegExp('^' + RegExp.escape(val.substr(offset)), 'i');
      complete = complete || {
        i: 0,
        prefix: val.substr(0, offset),
        list: $.map(
          $.grep(
            nicks.revrange(0, -1).concat(conversation_list).concat(commands).unique(),
            function(v, i) {
              return offset && v.indexOf('/') === 0 ? false : re.test(v) ? true : false;
            }
          ),
          function(v, i) {
            return offset ? v + ' ' : v.indexOf('/') === 0 ? v : v + ': ';
          }
        ).concat(val.substr(offset))
      };

      $input.val(complete.prefix + complete.list[complete.i++]);
      if(complete.i == complete.list.length) complete.i = 0;
      return false;
    };

    $.get($.url_for('/chat/command-history'), noCache({}), function(data) {
      $input.history = data;
      $input.history_i = $input.history.length;
    });

    $input.removeAttr('disabled');
    $input.bind('keydown', function(e) { if(e.keyCode !== 9) complete = false; }); // not tab
    $input.bind('keydown', 'tab', autocomplete);
    $input.bind('keydown', 'up', function(e) {
      e.preventDefault();
      if($input.history_i == 0) return;
      if($input.history_i == $input.history.length) current = $input.val();
      $input.val($input.history[--$input.history_i]);
    });
    $input.bind('keydown', 'down', function(e) {
      e.preventDefault();
      if(++$input.history_i == $input.history.length) return $input.val(current);
      if($input.history_i > $input.history.length) return $input.history_i = $input.history.length;
      $input.val($input.history[$input.history_i]);
    });
    $input.closest('form').submit(function(e) {
      e.preventDefault();
      $input.send($input.val(), { 'data-history': 1 }).val('');
    });
  };

  var initPjax = function() {
    $(document).on('pjax:timeout', function(e) { e.preventDefault(); });
    $(document).pjax('nav a.conversation', 'div.messages', { fragment: 'div.messages' });
    $(document).pjax('nav a.convos', 'div.messages', { fragment: 'div.messages' });

    $('div.messages').on('pjax:beforeSend', function(xhr, options) { return !$(this).hasClass('no-pjax'); });
    $('div.messages').on('pjax:start', function(xhr, options) { $('body').loadingIndicator('show'); });
    $('div.messages').on('pjax:success', conversationLoaded);
  }

  var initSocket = function() {
    var url = $input.closest('form').data('socket-url');
    if(!url) return;
    var socket = $input.data('socket', new ReconnectingWebSocket({ url: url, ping_protocol: [ 'PING', 'PONG' ] })).data('socket');
    $input.history = [];
    $input.history_i = 0;
    socket.onmessage = receiveMessage;
    socket.onclose = function() { $input.addClass('disabled'); };
    socket.onopen = function(e) { $input.removeClass('disabled'); if(e.reconnected) getNewMessages.call(document, { goto_bottom: true, silent: true }); };
    socket.onpong = function(e) { $input.attr('placeholder', 'What\'s on your mind ' + $messages.attr('data-nick') + '?'); };
    $input.send = function(message, attr) {
      if(message.length == 0) return $input;
      attr = attr || {};
      attr['data-state'] = $messages.attr('data-state');
      attr['id'] = window.guid();
      if(!message.match('^\/') || attr.pending_status) {
        var $pendingMessage = $('<li class="message-pending"><div class="content"></div></li>').attr('id', attr.id).hostAndTarget($messages);
        $pendingMessage.find('.content').text(message);
        setTimeout(function() { messageFailed($pendingMessage); }, 10000);
        $pendingMessage.appendToMessages();
        $win.scrollTo('bottom');
      }
      socket.send($('<div/>').hostAndTarget($messages).attr(attr).text(message).prop('outerHTML'));
      if(attr['data-history']) $input.history.push(message);
      $input.history_i = $input.history.length;
      return $input;
    };
  }

  var initShortcuts = function() {
    $('body, input, button').bind('keydown', 'alt+shift+a shift+return', function() { $('nav a.conversations').click(); return false; });
    $('body, input, button').bind('keydown', 'alt+shift+s', function() { $('nav a.notifications').click(); return false; });
    $('body, input, button').bind('keydown', 'alt+shift+d', function() { $('nav a.sidebar').filter(':visible').click(); return false; });
  };

  var nickList = function($data) {
    var $nicks = $data.find('[data-nick]');
    var $ul = $('form.sidebar ul');
    var network = $messages.data('network');
    var senders = {};

    if($nicks.length) {
      $messages.find('li[data-sender]').each(function(i) {
        senders[$(this).data('sender')] = i;
      });

      $nicks.each(function() {
        var $a = $(this);
        var n = $a.data('nick');
        nicks.add(senders[n] || 1, n);
      });
    }

    $ul.children('.nick').remove();

    if(nicks.length) {
      $.map(nicks.revrange(0, -1).sortCaseInsensitive(), function(n, i) {
        var $a = $('<a href="cmd:///query ' + n + '" />').click(function() { $input.send('/query ' + n); return false; }).append(n);
        $ul.append($('<li class="nick" />').append($a));
      }).join('')
    }
  }

  var messageFailed = function($message) {
    var uuid = $message.attr('id');
    $messages.find('#' + uuid)
      .filter('.message-pending')
      .addClass('message-error')
      .removeClass('message-pending')
      .prepend('<h3>Could not send message</h3>')
      .prepend('<span class="actions"><button class="resend-message">Resend</button> <button class="remove-message">&times;</button></span>')
      ;
  }

  var noCache = function(args) {
    args._ts = new Date().getTime();
    return args;
  };

  var receiveMessage = function(e) {
    var at_bottom = $win.atBottom();
    var $message = $(e.data);
    var uuid = $message.attr('id');
    var to_current;

    if($messages.find('#' + uuid).length) {
      if($message.hasClass('error')) {
        messageFailed($message);
      }
      else {
        $messages.find('#' + uuid).remove();
      }
    }

    if($message.data('target') === '') {
      $message.data('target', $messages.data('target'));
      if(!$message.data('network')) $message.data('network', $messages.data('network'));
    }

    to_current = Object.equals($message.hostAndTarget(), $messages.hostAndTarget());

    if($message.hasClass('highlight')) {
      var sender = $message.data('sender');
      var what = /^[#&]/.test($message.data('target')) ? 'mentioned you in ' + $message.data('target') : 'sent you a message';
      var reload_notification_list_args = {};
      $.notify([sender, what].join(' '), $message.find('.content').text(), $message.find('img').attr('src'));
      reloadNotificationList(reload_notification_list_args);
    }

    if($message.hasClass('remove-conversation')) {
      var path = [$message.attr('data-network'), encodeURIComponent($message.attr('data-target'))].join('/');
      $('nav ul.conversations a').slice(1).each(function() { if(this.href.indexOf(path) == -1) $(this).click(); });
    }
    else if($message.hasClass('add-conversation')) {
      var path = ['', $message.attr('data-network'), encodeURIComponent($message.attr('data-target'))].join('/');
      $.pjax({ url: path, container: 'div.messages'})
    }
    else if(to_current) {
      $message.appendToMessages();
    }
    else if($message.hasClass('message')) {
      drawConversationMenu($message);
    }

    if(at_bottom) $win.scrollTo('bottom');
  };

  var reloadNotificationList = function(e) {
    var $notification_list = $('div.notifications.container ul').parent();
    var $n_notifications = $('nav a.notifications');
    var reload_notification_list_args = {};
    var n;

    if(typeof e.clear_notification != 'undefined') {
      reload_notification_list_args.notification = e.clear_notification;
    }

    $.get($.url_for('/chat/notifications'), noCache(reload_notification_list_args), function(data) {
      $notification_list.html(data);
      n = parseInt($notification_list.children('ul').data('notifications'), 10);
      $n_notifications.children('b').text(n ? n : '');
    });
  };

  $(document).ready(function() {
    $input = $('form.chat input[autocomplete="off"]');
    $win = $(window);
    conversation_list = $('ul.conversations a').map(function() { return $(this).text(); }).get();

    if($input.length == 0) {
      return;
    }

    $.post($.url_for('/profile/timezone/offset'), { hour: new Date().getHours() });
    $input.focus();

    $.ajaxSetup({
      error: function(jqXHR, exception) {
        console.log('ajax: ' + this.url + ' failed: ' + exception);
      }
    });

    if(navigator.is_ios) {
      $('input, textarea').on('click', function() {
        $('nav').hide();
      }).on('focusout', function() {
        $('nav').show();
      });
    }

    initSocket();
    initPjax();
    initConversations();
    initInputField();
    initShortcuts();
    drawConversationMenu();
    drawSettings();

    $win.on('scroll', getHistoricMessages).on('resize', drawUI);
    $('.messages').on('click', '.resend-message', function() {
      $input.data('socket').buffer = []; // need to clear buffer when resending messages
      $input.send($(this).parents('li').find('.content').text());
      $(this).parents('li').remove();
    });
    $('.messages').on('click','.remove-message', function() {
      $(this).parents('li').remove();
    });
  });

  $(document).ready(function() {
    $('.login, .register').find('form input[type="text"]:first').focus();
  });

  $(window).load(function() {
    if($input.length) conversationLoaded();
  });

})(jQuery);
