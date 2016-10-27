"use strict";

let setup = require('./bot_setup.js');

let Botkit = require('botkit');
let Spotify = require('spotify-node-applescript');

let https = require('https');
let os = require('os');
let q = require('q');

var lastTrackId;
var lastVolume = 0;
var channelId;

var controller = Botkit.slackbot({
    debug: false,
});

var bot = controller.spawn({
    token: setup.token
}).startRTM();


var init = () => {
    bot.api.channels.list({}, function(err, response) {
        if(err) {
            throw new Error(err);
        }

        if (response.hasOwnProperty('channels') && response.ok) {
            var total = response.channels.length;
            for (var i = 0; i < total; i++) {
                var channel = response.channels[i];
                if(verifyChannel(channel)) {
                    return;
                }
            }
        }
    });

    bot.api.groups.list({}, function(err, response) {
        if(err) {
            throw new Error(err);
        }

        if (response.hasOwnProperty('groups') && response.ok) {
            var total = response.groups.length;
            for (var i = 0; i < total; i++) {
                var channel = response.groups[i];
                if(verifyChannel(channel)) {
                    return;
                }
            }
        }
    });
};

controller.hears(['^help$'],'direct_message,direct_mention,mention', function(bot, message) {
    bot.reply(message,'You can say these things to me:\n'+
        '\t⦿ *next* – _Fed up with the track? Skip it._\n'+
        '\t⦿ *previous* – _Want to hear that again? Just ask._\n'+
        '\t⦿ *start again* / *over* – _Missed the beginning of the track? No problem._\n'+
        '\t⦿ *volume up* / *down* – _increases / decreases the volume_\n'+
        '\t⦿ *set volume* [1-100] – _sets the volume_\n'+
        '\t⦿ *shuffle* [on/off] – _toggles shuffle_\n'+
        '\t⦿ *repeat* [on/off] – _toggles repeat_\n'+
        '\t⦿ *status* – _I will tell information about the Spotify player_\n'+
        '\t⦿ *info* – _I will tell you about this track_\n'+
        '\t⦿ *detail* – _I will tell you more about this track_\n'+
        '\t⦿ *play* / *pause* – _plays or pauses the music_\n'+
        '\t⦿ *play* [spotify uri] – _plays a specific uri_\n'+
        '\t⦿ *play track* [track name] - [optional artist name] – _plays a specific track_\n'+
        '\t⦿ *play album* [album name] - [optional artist name] – _plays a specific album_\n'+
        '\t⦿ *play artist* [artist name] – _plays a specific album_\n'+
        '\t⦿ *play playlist* [playlist name] – _plays a specific playlist_\n'
    );
});

controller.hears(['^hello$','^hi$'],'direct_message,direct_mention,mention',function(bot,message) {

    bot.api.reactions.add({
        timestamp: message.ts,
        channel: message.channel,
        name: 'radio',
    }, function(err,res) {
        if (err) {
            bot.botkit.log("Failed to add emoji reaction :(",err);
        }
    });


    controller.storage.users.get(message.user,function(err,user) {
        if (user && user.name) {
            bot.reply(message,"Hello " + user.name + "!!");
        }
        else {
            bot.reply(message,"Hello.");
        }
    });
});

controller.hears(['repeat(?: (on|off))?'],'direct_message,direct_mention,mention',function(bot,message) {

    var repeating = true;

    if(message.match && message.match[1]) {
        if(message.match[1] === 'on') {
            repeating = true;
        }
        else if(message.match[1] === 'off') {
            repeating = false;
        }
        else {
            return;
        }
    }

    var repeatingText = repeating ? 'on' : 'off';

    Spotify.setRepeating(repeating, function(err) {
        if(err) {
            bot.reply(message, "Error turning repeat "+repeatingText);
        }
        else {
            bot.reply(message, "Repeat is now "+repeatingText);
        }
    });
    
});

controller.hears(['shuffle(?: (on|off))?'],'direct_message,direct_mention,mention',function(bot,message) {

    var shuffling = true;

    if(message.match && message.match[1]) {
        if(message.match[1] === 'on') {
            shuffling = true;
        }
        else if(message.match[1] === 'off') {
            shuffling = false;
        }
        else {
            return;
        }
    }

    var shufflingText = shuffling ? 'on' : 'off';

    Spotify.setShuffling(shuffling, function(err) {
        if(err) {
            bot.reply(message, "Error turning shuffle "+shufflingText);
        }
        else {
            bot.reply(message, "Shuffle is now "+shufflingText);
        }
    });
    
});

/*
track = {
    artist: 'Bob Dylan',
    album: 'Highway 61 Revisited',
    disc_number: 1,
    duration: 370,
    played count: 0, // don't think this works.
    track_number: 1,
    starred: false,
    popularity: 71,
    id: 'spotify:track:3AhXZa8sUQht0UEdBJgpGc',
    name: 'Like A Rolling Stone',
    album_artist: 'Bob Dylan',
    spotify_url: 'spotify:track:3AhXZa8sUQht0UEdBJgpGc' }
}
*/
controller.hears(['^info$','^playing$','^what','^who'],'direct_message,direct_mention,mention', function(bot, message) {
    Spotify.getTrack(function(err, track){
        if(track) {
            lastTrackId = track.id;
            bot.reply(message, "> "+trackFormatSimple(track));
        }
    });
});

controller.hears(['^details?$'],'direct_message,direct_mention,mention', function(bot, message) {
    Spotify.getTrack(function(err, track){
        if(track) {
            lastTrackId = track.id;
            bot.reply(message, "> "+trackFormatDetail(track)+" "+track.spotify_url);
        }
    });
});

controller.hears(['^status$'],'direct_message,direct_mention,mention', function(bot, message) {
    // shuffle, repeat,
    q.all([checkRunning(), getState(), checkRepeating(), checkShuffling()]).
        then(function(results) {
            var running = results[0],
                state = results[1],
                repeating = results[2],
                shuffling = results[3];

            var reply = "Current status:\n";

            if(running && state) {
                reply += "    Spotify is *running*\n"+
                    "    Repeat: *" + (repeating ? 'On' : 'Off') + "*\n"+
                    "    Shuffle: *" + (shuffling ? 'On' : 'Off') + "*\n"+
                    "    Volume: *" + state.volume + "*\n"+
                    "    Position in track: *" + state.position + "*\n"+
                    "    State: *" + state.state + "*\n";
            }
            else {
                reply += "Spotify is *NOT* running";
            }

            bot.reply(message, reply);
        });
});

controller.hears(['next','skip'],'direct_message,direct_mention,mention', function(bot, message) {
    Spotify.next(function(err, track){
        bot.reply(message, 'Skipping to the next track...');
    });
});

controller.hears(['previous','prev'],'direct_message,direct_mention,mention', function(bot, message) {
    var currentTrack;
    Spotify.getTrack(function(err, track){
        if(track) {
            currentTrack = track.id;

            (function previousTrack() {
                Spotify.previous(function(err, track){
                    Spotify.getTrack(function(err, track){
                        if(track) {
                            if(track.id !== currentTrack) {
                                bot.reply(message, 'Skipping back to the previous track...');
                            }
                            else {
                                previousTrack();
                            }
                        }
                    });
                });
            })();
        }
    });
});

controller.hears(['start (again|over)'],'direct_message,direct_mention,mention', function(bot, message) {
    Spotify.jumpTo(0, function(err, track){
        bot.reply(message, 'Going back to the start of this track...');
    });
});

controller.hears(['^play$','^resume$','^go$'],'direct_message,direct_mention,mention', function(bot, message) {
    Spotify.getState(function(err, state){
        if(state.state == 'playing') {
            bot.reply(message, 'Already playing...');
            return;
        }

        Spotify.play(function(){
            bot.reply(message, 'Resuming playback...');
        });
    });
});

let playURIRegex = '^(?:play )?<(.*)>$';
controller.hears(playURIRegex,'direct_message,direct_mention,mention', function(bot, message) {
    // parse play string
    let reg = new RegExp(playURIRegex);
    let uri = reg.exec(message.text)[1];

    playTrack(uri).
    then(ok => {
        addReaction(message, '+1');
    });
});

let playTypeRegex = '^(?:play )?(playlist|artist|album|track) (.*)$';
controller.hears(playTypeRegex,'direct_message,direct_mention,mention', function(bot, message) {
    // parse play string
    let reg = new RegExp(playTypeRegex);
    let type = reg.exec(message.text)[1];
    let query = reg.exec(message.text)[2];

    searchFor(query, [type]).
    then(results => {
        if(results[type+'s'].items.length > 0) {
            return playTrack(results[type+'s'].items[0].uri).
                then(ok => {
                    addReaction(message, '+1');
                });
        }
        else {
            return q.reject();
        }
    }).
    catch(err => {
        console.log('Problem playing '+type+': \"'+message.text+'\"', err);
        bot.reply(message, 'Sorry, I\'m having trouble with that request 😢');
    });
});

controller.hears(['^stop$','^pause$','^shut up$'],'direct_message,direct_mention,mention', function(bot, message) {
    Spotify.getState(function(err, state){
        if(state.state != 'playing') {
            bot.reply(message, 'Not currently playing...');
            return;
        }

        Spotify.pause(function(){
            bot.reply(message, 'Pausing playback...');
        });
    });
});

controller.hears(['louder( \\d+)?','vol(?:ume)? up( \\d+)?','pump it( \\d+)?'],'direct_message,direct_mention,mention', function(bot, message) {
    var increase = message.match ? parseInt(message.match[1], 10) : undefined;
    Spotify.getState(function(err, state){
        var volume = state.volume;

        if(volume == 100) {
            bot.reply(message, 'Already playing at maximum volume!');
            return;
        }

        var newVolume = increase ? volume + increase : volume + 10;
        if(!newVolume) {
            return;
        }
        else if(newVolume > 100) {
            newVolume = 100;
        }

        Spotify.setVolume(newVolume, function(){
            bot.reply(message, `Increased volume from ${volume} to ${newVolume}`);
        });
    });
});

controller.hears(['quieter( \\d+)?','vol(?:ume)? down( \\d+)?','turn it down( \\d+)?','shh+( \\d+)?'],'direct_message,direct_mention,mention', function(bot, message) {
    var decrease = message.match ? parseInt(message.match[1], 10) : undefined;
    Spotify.getState(function(err, state){
        var volume = state.volume;

        if(volume == 0) {
            bot.reply(message, 'I can\'t go any lower... (my career as a limbo dancer was a short one)');
            return;
        }

        var newVolume = decrease ? volume - decrease : volume - 10;
        if(!newVolume && newVolume !== 0) {
            return;
        }
        else if(newVolume < 0) {
            newVolume = 0;
        }

        Spotify.setVolume(newVolume, function(){
            bot.reply(message, `Decreased volume from ${volume} to ${newVolume}`);
        });
    });
});

controller.hears('(?:set )?vol(?:ume)? (\\d+)','direct_message,direct_mention,mention', function(bot, message) {
    var volume = message.match ? parseInt(message.match[1], 10) : undefined;
    Spotify.getState(function(err, state){
        var oldVolume = state.volume;

        if(volume !== undefined && volume >= 0 && volume <= 100) {
            Spotify.setVolume(volume, function(){
                bot.reply(message, `Changed volume from ${oldVolume} to ${volume}`);
            });
            return;
        }

        bot.api.reactions.add({
            timestamp: message.ts,
            channel: message.channel,
            name: 'trollface',
        }, function(err,res) {
            if (err) {
                bot.botkit.log("Failed to add emoji reaction :(",err);
            }
        });
        bot.reply(message, 'Volume can be set from 0-100');
    });
});


controller.hears('\\brick ?roll\\b','message,direct_message,direct_mention,mention', function(bot, message) {
    playTrack('spotify:track:4uLU6hMCjMI75M1A2tKUQC').
    then(() => bot.reply(message, ':trollface:'));
});


controller.on('bot_channel_join', function(bot, message) {
    let inviterId = message.inviter;
    let channelId = message.channel;
    var inviter, channel;

    let done = () => {
        if(inviter && channel) {
            inviteMessage(inviter, channel);
            verifyChannel(channel);
        }
    };

    bot.api.channels.info({channel: channelId}, function(err, response) {
        if(response && !err) {
            channel = response.channel;
            done();
        }
    });

    bot.api.users.info({user: inviterId}, function(err, response) {
        if(response && !err) {
            inviter = response.user;
            done();
        }
    });
});

controller.on('bot_group_join', function(bot, message) {
    let inviterId = message.inviter;
    let channelId = message.channel;
    var inviter, channel;

    let done = () => {
        if(inviter && channel) {
            inviteMessage(inviter, channel);
            verifyChannel(channel);
        }
    };

    bot.api.groups.info({channel: channelId}, function(err, response) {
        if(response && !err) {
            channel = response.group;
            done();
        }
    });

    bot.api.users.info({user:  inviterId}, function(err, response) {
        if(response && !err) {
            inviter = response.user;
            done();
        }
    });
});


function inviteMessage(inviter, channel) {
    Spotify.getTrack(function(err, track){
        var nowPlaying;
        let welcomeText = `Thanks for inviting me, ${inviter.name}! Good to be here :)\n`;

        if(track) {
            lastTrackId = track.id;
            getArtworkUrlFromTrack(track, function(artworkUrl) {
                bot.say({
                    text: welcomeText+'> '+trackFormatSimple(track),
                    channel: channel.id
                });
            });
        }
        else {
            bot.say({
                text: welcomeText+'There is nothing currently playing',
                channel: channel.id
            });
        }
    });
}


setInterval(() => {
    checkRunning()
    .then(function(running) {
        if(running) {
            checkForTrackChange();
        }
        else {
            if(lastTrackId !== null) {
                bot.say({
                    text: 'Oh no! Where did Spotify go? It doesn\'t seem to be running 😨',
                    channel: channelId
                });
                lastTrackId = null
            }
        }
    });
}, 5000);


function getState() {
    var deferred = q.defer();

    Spotify.getState(function(err, state) {
        if(err || !state) {
            return deferred.resolve(false);
        }

        return deferred.resolve(state);
    });

    return deferred.promise;
}

function checkRunning() {
    var deferred = q.defer();

    Spotify.isRunning(function(err, isRunning) {
        if(err || !isRunning) {
            return deferred.resolve(false);
        }

        return deferred.resolve(true);
    });

    return deferred.promise;
}

function checkShuffling() {
    var deferred = q.defer();

    Spotify.isShuffling(function(err, isShuffling) {
        if(err) {
            return deferred.reject(err);
        }

        return deferred.resolve(isShuffling);
    });

    return deferred.promise;
}

function checkRepeating() {
    var deferred = q.defer();

    Spotify.isRepeating(function(err, isRepeating) {
        if(err) {
            return deferred.reject(err);
        }

        return deferred.resolve(isRepeating);
    });

    return deferred.promise;
}

function checkForTrackChange() {
    Spotify.getTrack(function(err, track) {
        if(track && (track.id !== lastTrackId)) {
            if(!channelId) return;

            lastTrackId = track.id;

            if(setup.muteAds) {
                if(!track.artist) {
                    getState().then(state => {
                        if(lastVolume === 0) { // not currently muting (can't fully mute or playback stops)
                            lastVolume = state.volume;
                            Spotify.setVolume(1, function(){
                                bot.say({
                                    text: `Back soon...`,
                                    channel: channelId
                                });
                            });
                        }
                    });
                    return;
                }
                else {
                    if(lastVolume !== 0) {
                        Spotify.setVolume(lastVolume);
                        lastVolume = 0;
                    }
                }
            }

            getArtworkUrlFromTrack(track, function(artworkUrl) {
                bot.say({
                    text: `> ${trackFormatSimple(track)}\n> ${artworkUrl}`,
                    channel: channelId
                });
            });
        }
    });
}


/**
 * Calls Spotify API to search for an item
 * @param {String} query
 * @param {String[]} resultTypes Any of 'track', 'arsit', 'album', 'playlist'
 * @return {Promise} Resolved with successful query response payload
 */
function searchFor(query, resultTypes) {
    let deferred = q.defer();
    let reqUrl = 'https://api.spotify.com/v1/search?limit=50&q='+encodeURIComponent(query)+'&type='+resultTypes.join(',');

    var req = https.request(reqUrl, function(response) {
        var str = '';

        response.on('data', function (chunk) {
            str += chunk;
        });

        response.on('end', function() {
            var json = JSON.parse(str);
            if(json && (json.albums || json.artists || json.tracks || json.playlists)) {
                deferred.resolve(json);
            }
            else {
                deferred.reject('Bad response');
            }
        });
    });
    req.end();

    req.on('error', function(e) {
      console.error(e);
    });

    return deferred.promise;
}


/**
 * Plays a track, optionally within a context
 */
function playTrack(trackUri, contextUri) {
    let deferred = q.defer();

    if(contextUri) {
        Spotify.playTrackInContext(trackUri, contextUri, err => {
            if(err) {
                deferred.reject(err);
            }
            else {
                deferred.resolve(true);
            }
        });
    }
    else {
        Spotify.playTrack(trackUri, err => {
            if(err) {
                deferred.reject(err);
            }
            else {
                deferred.resolve(true);
            }
        });
    }

    return deferred.promise;
}


let trackFormatSimple = track => {
    var out = '';
    if(track.name) {
        out += `“${track.name}”`;
        if(track.artist) {
            out += ` by ${track.artist}`;
        }
    }
    return out;
};

let trackFormatDetail = track => {
    var out = '';
    if(track.name) {
        out += `“${track.name}”`;
        if(track.artist) {
            out += ` by ${track.artist}`;
        }
        if(track.album) {
            out += ` from the album _${track.album}_`;
        }
    }
    return out;
};

let getArtworkUrlFromTrack = (track, callback) => {
    let trackId = track.id.split(':')[2];
    let reqUrl = 'https://api.spotify.com/v1/tracks/'+trackId;
    var req = https.request(reqUrl, function(response) {
        var str = '';

        response.on('data', function (chunk) {
            str += chunk;
        });

        response.on('end', function() {
            var json = JSON.parse(str);
            if(json && json.album && json.album.images && json.album.images[1]) {
                callback(json.album.images[1].url);
            }
            else {
                callback('');
            }
        });
    });
    req.end();

    req.on('error', function(e) {
      console.error(e);
    });
};

controller.hears(['uptime','identify yourself','who are you','what is your name'],'direct_message,direct_mention,mention',function(bot,message) {
    var hostname = os.hostname();
    var uptime = formatUptime(process.uptime());

    bot.reply(message,':robot_face: I am a bot named <@' + bot.identity.name +'>. I have been running for ' + uptime + ' on ' + hostname + ".");
});

function formatUptime(uptime) {
    var unit = 'second';
    if (uptime > 60) {
        uptime = uptime / 60;
        unit = 'minute';
    }
    if (uptime > 60) {
        uptime = uptime / 60;
        unit = 'hour';
    }
    if (uptime != 1) {
        unit = unit +'s';
    }

    uptime = uptime + ' ' + unit;
    return uptime;
}

function verifyChannel(channel) {
    if(channel && channel.name && channel.id && setup.channel && channel.name == setup.channel) {
        channelId = channel.id;
        console.log('** ...chilling out on #' + channel.name);
        return true;
    }

    return false;
}

function addReaction(message, emoji) {
    bot.api.reactions.add({
        timestamp: message.ts,
        channel: message.channel,
        name: emoji,
    }, function(err,res) {
        if (err) {
            bot.botkit.log("Failed to add emoji reaction :(",err);
        }
    });
}

init();
