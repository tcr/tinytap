#!/usr/bin/env node

// Executable to run other files.

var spawn = require('child_process').spawn;
var parse = require('shell-quote').parse;
var quote = require('shell-quote').quote;
var stream = require('stream');
var glob = require('glob');

var tinytap = require('../src/parser');

var args = process.argv.slice(2);
var list = [[null]];
var parallel = 1;

for (var i = 0; i < args.length; i++) {
	if (args[i] == '-e' || args[i] == '--exec') {
		i += 1;
    list.push([args[i]]);
  } else if (args[i].match(/^\-p(\d+)/)) {
    parallel = parseInt(args[i].match(/^\-p(\d+)/)[1]);
  } else if (args[i] == '-f' || args[i] == '--filter') {
    i += 1;
    list[list.length - 1].push('!' + args[i]);
  } else {
		list[list.length - 1].push(args[i]);
	}
}

if (list[0].length > 1) {
  throw new Error('Test ' + list[0][1] + 'specified without an executable.');
}
list.shift();

var total = 0, currentttest = 1, testsuccess = 0;

for (var i = 0; i < list.length; i++) {
  var filter = []
  var globbed = Array.prototype.concat.apply([], list[i].slice(1).map(function (match) {
    if (match.charAt(0) == '!') {
      filter = filter.concat(glob.sync(match.substr(1)));
      return [];
    } else {
      return glob.sync(match); 
    }
  })).filter(function (file) {
    return filter.indexOf(file) == -1;
  });
  total += globbed.length;
  list[i].splice(1, list[i].length - 1, globbed);
}

var groups = list;

process.stderr.setMaxListeners(0);

console.log('1..' + total);

(function nextgroup (group) {
  var exe = group[0];
  var files = group[1];

  files.splice(0, parallel).forEach(function nextfile (file) {
    var usedarg = false;
    var spawncmd = parse(exe, process.env).map(function (arg) {
      if (arg == '{}') {
        usedarg = true;
        return file;
      }
      return arg;
    }).concat(usedarg ? [] : [file]);

    var proc = spawn(spawncmd[0], spawncmd.slice(1));
    var tap = proc.stdout.pipe(tinytap.parseStream());

    function prefixStream () {
      var transform = new stream.Transform()
      var buf = '';
      transform._transform = function (chunk, encoding, callback) {
        buf += chunk.toString(encoding == 'buffer' ? null : encoding);
        var pos;
        while ((pos = buf.indexOf('\n')) > -1) {
          this.push(' | ' + buf.slice(0, pos) + '\n');
          buf = buf.slice(pos + 1);
        }
        callback();
      }
      return transform;
    }

    if (parseInt(process.env.TAP_VERBOSE) != 0 && parseInt(process.env.TAPV) != 0) {
      proc.stdout.pipe(prefixStream()).pipe(process.stderr);
      proc.stderr.pipe(prefixStream()).pipe(process.stderr);
    }

    var exited = false, completed = false, code = -1;
    proc.on('exit', function (_code) {
      code = _code;
      exited = true;
      exited && completed && procComplete();
    })

    tap.on('complete', function () {
      completed = true;
      exited && completed && procComplete();
    });

    function procComplete () {
      console.log(tap.success && code == 0 ? 'ok' : 'not ok', currentttest++, '-', file + (code != 0 ? ' (exit code ' + code + ')' : ''));
      tap.success && code == 0 && testsuccess++;

      if (files.length) {
        nextfile(files.shift());
      } else if (groups.length) {
        nextgroup(groups.shift());  
      } else if (currentttest > total) {
        finish();
      }
    }
  });
})(groups.shift());

function finish (code) {
  var success = total - testsuccess == 0;
  console.log(success ? 'ok' : 'not ok', currentttest++, '-', '(' + (success ? '' : 'not ') + 'all tests pass.)')
  process.exit(total - testsuccess);
}
