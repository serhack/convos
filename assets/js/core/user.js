(function() {
  Convos.User = function(attrs) {
    this.connected     = false;
    this.connections   = [];
    this.currentPage   = "";
    this.dialogs       = [];
    this.email         = "";
    this.notifications = [];
    this.unread        = 0;
    EventEmitter(this);

    this.once("login", this._setupWebSocket);
    this.on("login", function(data) {
      Convos.settings.dialogsVisible = false;
      this.email = data.email;
    });
  };

  var proto = Convos.User.prototype;

  proto.ensureDialog = function(data) {
    if (!data.dialog_id) data.dialog_id = "convosbot"; // this is a hack to make sure we always have a fallback conversation
    if (data.dialog_id) data.id = data.dialog_id;

    var dialog = this.dialogs.filter(function(d) {
      return d.connection_id == data.connection_id && d.id == data.dialog_id;
    })[0];

    if (!dialog) {
      if (data.connection && !data.connection_id) data.connection_id = data.connection.id;
      if (!data.name) data.name = data.from || data.dialog_id;
      delete data.connection;
      data.id = data.dialog_id;
      data.user = this;
      dialog = new Convos.Dialog(data);
      this.dialogs.push(dialog);
    }

    return dialog;
  };

  proto.getActiveDialog = function(id) {
    return this.dialogs.filter(function(d) { return d.href() == Convos.settings.main; })[0];
  };

  proto.getConnection = function(id) {
    return this.connections.filter(function(c) { return c.id == id; })[0];
  };

  proto.makeSureLocationIsCorrect = function() {
    var correct, loc = Convos.settings.main;
    if (loc.indexOf("#chat") != 0) return;
    this.dialogs.forEach(function(d) { if (d.href() == loc) correct = true; });
    if (!correct) Convos.settings.main = this.dialogs.length ? this.dialogs[0].href() : "";
  };

  proto.refresh = function(cb) {
    var self = this;
    Convos.api.getUser({connections: true, dialogs: true, notifications: true}, function(err, xhr) {
      if (err) return cb.call(self, err);
      self.connections = xhr.body.connections.map(function(c) {
        c.user = self;
        c.id = c.connection_id;
        return new Convos.Connection(c);
      });
      self.dialogs = xhr.body.dialogs.map(function(d) { return self.ensureDialog(d).update(d) });
      self.notifications = xhr.body.notifications.reverse();
      self.unread = xhr.body.unread || 0;
      cb.call(self, err);
    });
  };

  proto._setupWebSocket = function(data) {
    var self = this;
    this._cache = {};

    try { document.getElementById("loader").$remove() } catch(e) {};

    Convos.ws.on("close", function() {
      self.connected = false;
      self.connections.forEach(function(c) { c.state = "unreachable"; });
      self.dialogs.forEach(function(d) { d.frozen = "No internet connection?"; });
    });

    Convos.ws.on("json", function(data) {
      if (!data.connection_id) return console.log("[ws] json=" + JSON.stringify(data));
      var c = self.getConnection(data.connection_id);
      if (c) return c.emit(data.event, data);
      if (!self._cache[data.connection_id]) self._cache[data.connection_id] = [];
      self._cache[data.connection_id].push(data);
    });

    Convos.ws.on("open", function() {
      self.connected = true;
      self.refresh(function(err, res) {
        self.makeSureLocationIsCorrect();
        self.currentPage = "convos-chat";
        Object.keys(self._cache).forEach(function(connection_id) {
          var msg = self._cache[connection_id];
          var c = self.getConnection(connection_id);
          delete self._cache[connection_id];
          if (c) msg.forEach(function(d) { c.emit(d.event, d); });
        });
      });
    });

    Convos.ws.open();
  };
})();
