(function(){

if(typeof Function.empty == 'undefined')
        Function.empty = function(){};

if(typeof console == 'undefined')
        console = {
                'log': Function.empty,
                'debug': Function.empty,
                'info': Function.empty,
                'warn': Function.empty,
                'error': Function.empty,
                'assert': Function.empty
        };

//
// Misc utility functions
//

function create_tr(data) {
        var n_tr = document.createElement('tr');
        for(var i = 0; i < data.length; i++) {
                var n_td = document.createElement('td');
                n_td.appendChild(document.createTextNode(data[i]));
                n_tr.appendChild(n_td);
        }
        return n_tr;
};

function create_toolbox(key, that) {
    var buttons, i;
    if(key == null) {
        buttons = [['skip', 'Skip', 'ui-icon-seek-next', {'type': 'skip_playing'}]];
    } else {
        buttons = [
            ['up', 'Move up', 'ui-icon-circle-arrow-n', {'type': 'move_request', 'key': key, 'amount': -1}],
            ['down', 'Move down', 'ui-icon-circle-arrow-s', {'type': 'move_request', 'key': key, 'amount': 1}],
            ['del', 'Cancel', 'ui-icon-circle-close', {'type': 'cancel_request', 'key': key}],
        ];
    }
    var n_td = document.createElement('td');
    for(i = 0; buttons.length > i; i++) {
        var btn = document.createElement('button');
        (function() {
            var data = buttons[i];
            btn.appendChild(document.createTextNode(data[1]));
            $(btn).addClass(data[0]);
            $(btn).button({ icons: {primary: data[2]}, text: false });
            $(btn).click(function() {
                            that.channel.send_message(data[3]);
            });
        })();
        n_td.appendChild(btn);
    }
    return n_td;
}

function zpad_left(tmp, n) {
        var pad = '';
        for (var i = tmp.length; i < n; i++)
                pad += '0';
        return pad + tmp;
}

function nice_time(tmp) {
        neg = tmp < 0;
        if(neg) tmp = -tmp;
        var sec = parseInt(tmp % 60);
        tmp /= 60;
        var min = parseInt(tmp % 60);
        var hrs = parseInt(tmp / 60);
        if(hrs == 0)
                var ret = min.toString() + ':' + zpad_left(sec.toString(), 2);
        else
                var ret = hrs.toString() + ':' +
                                zpad_left(min.toString(), 2) + ':' +
                                zpad_left(sec.toString(), 2);
        if(neg) ret = '-' + ret;
        return ret;
}

//
// Main PijsMarietje class
//
function PijsMarietje() {
        this.after_login_cb = null;
        this.after_login_token_cb = null;
        this.uploader = null;
        this.logged_in = false;
        this.login_token = null;
        this.channel_ready = false;
        this.comet = null;
        this.channel = null;
        this.media = {};
        this.media_count = 0;
        
        this.updating_times = false;

        this.got_media = false;
        this.got_requests = false;
        this.got_playing = false;

        this.waiting_for_login_token = false;
        this.waiting_for_welcome = true;
        this.waiting_for_logged_in = false;
        this.waiting_for_media = 0;


        this.re_queryCheck = /^[a-z0-9 ]*$/;
        this.re_queryReplace = /[^a-z0-9 ]/g;

        this.showing_results = false;
        this.current_query = '';
        this.scroll_semaphore = 0;
        this.results_offset = null;
        this.mainTabShown = true;

        this.msg_map = {
                'welcome': this.msg_welcome,
                'login_token': this.msg_login_token,
                'logged_in': this.msg_logged_in,
                'error': this.msg_error,
                'error_login': this.msg_error_login,
                'error_login_accessKey': this.msg_error_login,
                'error_request': this.msg_error_request,
                'accessKey': this.msg_accessKey,
                'media': this.msg_media,
                'media_part': this.msg_media_part,
                'media_changed': this.msg_media_changed,
                'requests': this.msg_requests,
                'playing': this.msg_playing};
}

PijsMarietje.prototype.run = function() {
        this.setup_ui();
        this.setup_joyce();
};

PijsMarietje.prototype.setup_joyce = function() {
        var that = this;
        this.comet = new joyceCometClient(pijsmarietje_config.server);

        this.channel = this.comet.create_channel({
                'message': function(msg) {
                        var t = msg['type'];
                        if(t in that.msg_map)
                                that.msg_map[t].call(that, msg);
                        else
                                console.warn(["I don't know how to handle",
                                                msg]);
                }, 'ready': function() {
                        that.on_channel_ready();
                }});
};

//
// Message handlers
//

PijsMarietje.prototype.msg_error = function(msg) {
        $.jGrowl("Error: " + msg['message']);
}

PijsMarietje.prototype.msg_playing = function(msg) {
        var that = this;
        this.got_playing = true;
        this.playing = msg.playing;
        this.playing.requestTime = new Date().getTime() / 1000.0;
        this.refresh_requestsTable();
        if(!this.updating_times) {
                this.updating_times = true;
                setInterval(function() {
                        that.update_times();
                }, 1000);
        }
};

PijsMarietje.prototype.msg_media = function(msg) {
        var that = this;
        this.media = {};
        this.media_count = 0;
        if(msg.count == 0) {
                this.got_media = true;
                this.on_got_media();
                return;
        }
        this.waiting_for_media = msg.count;
        this.got_media = false;
        $.jGrowl('Receiving media<br/> <span class="media-received">0</span>/' 
                        + msg.count.toString(), {
                        sticky: true,
                        theme: 'media-not',
                        open: function() {
                                if(that.got_media) {
                                        return false;
                                }
                        }});
};

PijsMarietje.prototype.msg_media_changed = function(msg) {
        if(msg.changes == null) {
                $.jGrowl('Collection changed. Requesting changes.');
                this.channel.send_message({
                        'type': 'list_media'});
                return;
        }
        for(var i = 0; i < msg.changes.added.length; i++) {
                this.media[msg.changes.added[i].key] = msg.changes.added[i];
                $.jGrowl(msg.changes.added[i].artist + ' - ' +
                                msg.changes.added[i].title +
                                ' was added to the collection');
        }
        for(var i = 0; i < msg.changes.updated.length; i++) {
                this.media[msg.changes.updated[i].key] = msg.changes.updated[i];
                $.jGrowl(msg.changes.updated[i].artist + ' - ' +
                                msg.changes.updated[i].title +
                                ' was updated');
        }
        for(var i = 0; i < msg.changes.removed.length; i++) {
                $.jGrowl(msg.changes.removed[i].artist + ' - ' +
                                msg.changes.removed[i].title +
                                ' was removed');
                delete this.media[msg.changes.removed[i].key];
        }
        // TODO Update the queryCache incrementally
        this.reset_queryCache();
};

PijsMarietje.prototype.msg_media_part = function(msg) {
        for(var i = 0; i < msg.part.length; i++) {
                this.media[msg.part[i].key] = msg.part[i];
        }
        this.media_count += msg.part.length;
        this.waiting_for_media -= msg.part.length;
        $('.media-received').text(this.media_count);
        if(this.waiting_for_media == 0) {
                this.on_got_media();
        }
};

PijsMarietje.prototype.msg_login_token = function(msg) {
        this.login_token = msg['login_token'];
        this.on_login_token();
};

PijsMarietje.prototype.msg_accessKey = function(msg) {
        this.save_accessKey(this.username, msg['accessKey']);
};

PijsMarietje.prototype.msg_welcome = function(msg) {
        var that = this;
        if(this.waiting_for_welcome) {
                this.waiting_for_welcome = false;
                $('#welcome-dialog').dialog('close');
                var tmp = this.get_accessKey();
                if(tmp != null) {
                        function _do_ak_login() {
                                that.do_accessKey_login(tmp[0], tmp[1]);
                        };
                        if(this.login_token == null) {
                                if(this.waiting_for_login_token)
                                        return;
                                this.after_login_token_cb = function() {
                                        _do_ak_login();
                                };
                                this.request_login_token();
                        } else
                                _do_ak_login();
                }
        }
};

PijsMarietje.prototype.msg_logged_in = function(msg) {
        if(this.waiting_for_logged_in) {
                this.waiting_for_logged_in = false;
                $('#loggingin-dialog').dialog('close');
                if(this.logged_in)
                        return;
                this.logged_in = true;
                this.save_accessKey(this.username, msg['accessKey']);
                if(this.after_login_cb != null)
                        this.after_login_cb();
        }
};


PijsMarietje.prototype.msg_error_request = function(msg) {
        $.jGrowl('Request error: ' + msg['message']);
};

PijsMarietje.prototype.msg_error_login = function(msg) {
        if(this.waiting_for_logged_in) {
                this.waiting_for_logged_in = false;
                $('#loggingin-dialog').dialog('close');
                this.prepare_login();
                $('#login-dialog .error-msg').text(msg.message);
                $('#login-dialog .error-msg').show();
        }
};

PijsMarietje.prototype.msg_requests = function(msg) {
        this.requests = msg.requests;
        this.got_requests = true;
        this.refresh_requestsTable();
};

PijsMarietje.prototype.reset_queryCache = function() {
        this.qc = {'': []};
        var i = 0;
        for(var k in this.media) {
                var cr = this.re_queryReplace;
                this.qc[''][i++] = [k,
                        this.media[k].artist.toLowerCase().replace(cr, '') +'|'+
                        this.media[k].title.toLowerCase().replace(cr, '')];
        }
        console.debug('Initialized query cache');
};

PijsMarietje.prototype.on_got_media = function(msg) {
        this.got_media = true;
        $('.media-not .jGrowl-close').trigger('click');
        console.info('Received '+this.media_count.toString()+' media');
        this.reset_queryCache();
        if(this.got_requests || this.got_playing)
                this.refresh_requestsTable();
};

PijsMarietje.prototype.refresh_resultsTable = function() {
        var that = this;
        $('#resultsTable').empty();
        this.results_offset = 0;
        this.fill_resultsTable();
        setTimeout(function() {
                that.on_scroll();
        },0);
};

PijsMarietje.prototype.refresh_requestsTable = function() {
        $('#requestsTable').empty();
        this.fill_requestsTable();
};

PijsMarietje.prototype.fill_resultsTable = function() {
        var that = this;
        var t = $('#resultsTable');
        var cq = this.current_query;
        if(!this.got_media)
                return;
        this.do_query();
        var got = 0;
        for(; this.results_offset < this.qc[cq].length; this.results_offset++) {
                got += 1;
                var i = this.results_offset;
                var m = this.media[this.qc[cq][i][0]];
                var tr = create_tr([m.artist, m.title]);
                $(tr).data('key', this.qc[cq][i][0]);
                $('td:eq(0)',tr).addClass('artist');
                $('td:eq(0)',tr).addClass('title');
                $(tr).click(function() {
                        $('#queryField').val('');
                        that.check_queryField();
                        $('queryField').focus();
                        that.request_media($(this).data('key'));
                });
                t.append(tr);
                if(got == 10)
                        break;
        }
        this.results_offset++;
};

PijsMarietje.prototype.request_media = function(key) {
        var that = this;
        if(!this.logged_in) {
                that.after_login_cb = function() {
                        that.request_media(key);
                };
                this.prepare_login();
                return;
        }
        this.channel.send_message({
                type: 'request',
                mediaKey: key});
};

PijsMarietje.prototype.do_query = function() {
        var cq = this.current_query;
        for(var s = cq.length;
            !this.qc[cq.slice(0,s)];
            s--);
        for(var i = s; i < cq.length; i++) {
                var from = cq.slice(0, i);
                var to = cq.slice(0, i+1);
                var k = 0;
                this.qc[to] = [];
                for(var j = 0; j < this.qc[from].length; j++) {
                        if(this.qc[from][j][1].indexOf(to) != -1) {
                                this.qc[to][k] = this.qc[from][j];
                                k++;
                        }
                }
        } 
};

PijsMarietje.prototype.fill_requestsTable = function() {
        var that = this;
        var t = $('#requestsTable');
        var start = (this.got_playing ? -1 : 0);
        var end = (this.got_requests ? this.requests.length : 0);
        var ctime = null;
        for(var i = start; i < end; i++) {
                var m = (i == -1 ? this.playing.mediaKey
                                : this.requests[i].mediaKey);
                var b = (i == -1 ? this.playing.byKey
                                : this.requests[i].byKey);
                anonymous = false;
                if(!b) {
                        b = 'marietje';
                        anonymous = true;
                }
                var txt_a = m;
                var txt_t = '';
                if(this.got_media && m) {
                        txt_a = this.media[m].artist;
                        txt_t = this.media[m].title;
                }
                ctime = (i == -1 ? 0 :
                                (this.got_media ?
                                 ctime + this.media[m].length : 0));
                tr = create_tr([b, txt_a, txt_t,
                                (ctime == null ? '' : ctime)]);
                if(anonymous) {
                    $(tr).addClass('anonymous');
                }
                $(tr).data('offset', ctime);
                if(i == -1) {
                        $(tr).data('key', null);
                        $(tr).addClass('nowPlaying');
                }
                else
                        $(tr).data('key', this.requests[i].key);
                var tbx = create_toolbox($(tr).data('key'), that);
                tr.appendChild(tbx);
                $('td:eq(0)', tr).addClass('by');
                $('td:eq(1)', tr).addClass('artist');
                $('td:eq(2)', tr).addClass('title');
                $('td:eq(3)', tr).addClass('time');
                $('td:eq(4)', tr).addClass('toolbox');
                if(i == 0) {
                    $('td:eq(4) .up', tr).addClass('useless');
                }
                t.append(tr);
        }
        $('td:eq(4) .down', tr).addClass('useless');
        this.update_times();
};

PijsMarietje.prototype.get_accessKey = function() {
        if($.cookie('accessKey'))
                return [$.cookie('username'),
                        $.cookie('accessKey')];
        return null;
};

PijsMarietje.prototype.save_accessKey = function(username, accessKey) {
        $.cookie('username', username, { expires: 7 });
        $.cookie('accessKey', accessKey, { expires: 7 });
};

PijsMarietje.prototype.on_channel_ready = function() {
        // Create uploader
        this.uploader = new qq.FileUploader({
                element: $('#uploader')[0],
                action: this.channel.stream_url});

        // Request list of media and follow updates
        this.channel.send_messages([
                {'type': 'follow',
                 'which': ['playing', 'media', 'requests']}])
};

PijsMarietje.prototype.request_login_token = function() {
        if(this.waiting_for_login_token)
                return;
        this.channel.send_message({
                type: 'request_login_token' });
        this.waiting_for_login_token = true;
        $('#login-token-dialog').dialog('open');
};

PijsMarietje.prototype.prepare_login = function() {
        var that = this;
        if(this.waiting_for_login_token)
                return;
        if(this.login_token == null) {
                this.after_login_token_cb = function() {
                        $('#login-dialog').dialog('open');
                };
                this.request_login_token();
        } else
                $('#login-dialog').dialog('open');
};

PijsMarietje.prototype.on_login_token = function() {
        if(this.waiting_for_login_token) {
                this.waiting_for_login_token = false;
                $('#login-token-dialog').dialog('close');
                if(this.after_login_token_cb != null)
                        this.after_login_token_cb();
        }
};

PijsMarietje.prototype.do_accessKey_login = function(username, accessKey) {
        var hash = md5(accessKey + this.login_token);
        this.waiting_for_logged_in = true;
        $('#loggingin-dialog').dialog('open');
        this.channel.send_message({
                'type': 'login_accessKey',
                'username': username,
                'hash': hash});
}

PijsMarietje.prototype.do_login = function(username, password) {
        var hash = md5(md5(password) + this.login_token);
        this.username = username;
        this.waiting_for_logged_in = true;
        $('#loggingin-dialog').dialog('open');
        this.channel.send_message({
                'type': 'login',
                'username': username,
                'hash': hash});
}

PijsMarietje.prototype.update_times = function() {
        var that = this;
        var diff = (this.playing.endTime
                        - new Date().getTime() / 1000.0
                        - this.playing.serverTime
                        + this.playing.requestTime);
        $('#requestsTable tr').each(function(i, tr) {
                var offset = $(tr).data('offset');
                $('.time',tr).text(offset == null ? ''
                        : nice_time(offset + diff));
        });
};

PijsMarietje.prototype.setup_ui = function() {
        var that = this;
        // First, initialize the welcome dialog
        $("#welcome-dialog").dialog({
                autoOpen: that.waiting_for_welcome,
                modal: true,
                closeOnEscape: false,
                beforeClose: function() {
                        return !that.waiting_for_welcome;
                }
        });
        
        // Set up tabs
        $('#tabs').tabs({
                select: function(event, ui) {
                        that.mainTabShown = ui.index == 0;
                        if(ui.index == 1 && !that.logged_in) {
                                var tabs = $(this);
                                that.after_login_cb = function() {
                                        tabs.tabs('select', 1);
                                };
                                that.prepare_login();
                                return false;
                        }
                        return true;
                }
        });
        $( ".tabs-bottom .ui-tabs-nav, .tabs-bottom .ui-tabs-nav > *" )
                .removeClass( "ui-corner-all ui-corner-top" )
                .addClass( "ui-corner-bottom" );

        // Set up dialogs
        $( "#login-dialog" ).dialog({
                autoOpen: false,
                modal: true,
                buttons: {
                        "Login": function() {
                                $(this).dialog('close');
                                that.do_login($('#username').val(),
                                                $('#password').val());
                        },
                        "Cancel": function() {
                                $(this).dialog("close");
                        }
                }
        });
        $('#login-dialog .error-msg').hide();
        $('#login-dialog').keyup(function(e) {
                if(e.keyCode == 13) {
                        $(this).dialog('option',
                                        'buttons')["Login"].call(this);
                }
        });
        $("#login-token-dialog").dialog({
                autoOpen: false,
                modal: true,
                closeOnEscape: false,
                beforeClose: function() {
                        return !that.waiting_for_login_token;
                }
        });
        $("#loggingin-dialog").dialog({
                autoOpen: false,
                modal: true,
                closeOnEscape: false,
                beforeClose: function() {
                        return !that.waiting_for_logged_in;
                }
        });

        // Set up the main tables
        $('#requestsBar').focus(function() {
                that.focus_queryField();
        });
        $('#queryField').keypress(function(e) {
                return that.on_queryField_keyPress(e);
        });
        $('#queryField').keydown(function(e) {
                setTimeout(function() {
                        that.check_queryField();
                }, 0);
        });
        $('#resultsBar').hide();
        $('#tabsWrapper').scroll(function() {
                that.on_scroll();
        });

        this.focus_queryField();
}; 

PijsMarietje.prototype.focus_queryField = function() {
        $('#queryField').focus();
};

PijsMarietje.prototype.on_queryField_keyPress = function(e) {
        var that = this;
        if(e.which == 21) // C-u
                $('#queryField').val('');
        setTimeout(function() {
                that.check_queryField();
        }, 0);
};

PijsMarietje.prototype.check_queryField = function() {
        var that = this;
        var q = $('#queryField').val();
        if(!this.re_queryCheck.test(q)) {
                q = q.toLowerCase().replace(this.re_queryReplace, '');
                $('#queryField').val(q);
        }
        if(q == this.current_query)
                return;
        this.current_query = q;
        _cb = function() { that.up_scroll_semaphore(); };
        if(q == '' && this.showing_results) {
                this.down_scroll_semaphore();
                this.down_scroll_semaphore();
                $('#resultsBar').hide('fast', _cb);
                $('#requestsBar').show('fast', _cb);
                this.showing_results = false;
        } else if (q != '' && !this.showing_results) {
                this.down_scroll_semaphore();
                this.down_scroll_semaphore();
                $('#resultsBar').show('fast', _cb);
                $('#requestsBar').hide('fast', _cb);
                this.showing_results = true;
        }
        if(q != '') {
                this.refresh_resultsTable();
        }
};

PijsMarietje.prototype.up_scroll_semaphore = function() {
        this.scroll_semaphore++;
        if(this.scroll_semaphore == 0)
                this.on_scroll();
};

PijsMarietje.prototype.down_scroll_semaphore = function() {
        this.scroll_semaphore--;
};

PijsMarietje.prototype.on_scroll = function() {
        if(!this.mainTabShown || this.scroll_semaphore != 0
                        || !this.showing_results)
                return;
        var that = this;
        var diff = $('#tMain').height() -
                   $('#tabsWrapper').scrollTop() -
                   $('#tabsWrapper').height();
        if(diff <= 0) {
                this.fill_resultsTable();
                setTimeout(function(){
                        that.on_scroll();
                },0);
        }
};

$(document).ready(function(){
        pijsmarietje = new PijsMarietje();
        pijsmarietje.run();
});

})();
