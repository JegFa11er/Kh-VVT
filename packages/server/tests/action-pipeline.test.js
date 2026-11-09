"use strict";

/**
 * Integration tests for the server-side action intent pipeline (Step 2).
 *
 * Run with: npm run test --workspace=@pf2e/server
 */

const assert = require("node:assert/strict");

const { WebSocket } = require("ws");

const { EncounterSession } = require("../src/room/encounter-session.js");
const serverModule = require("../src/index.js");

const tests = [];

function test(name, handler) {
  tests.push({ name: name, handler: handler });
}

function makeSession() {
  const session = new EncounterSession({ id: "test-" + Math.random().toString(36).slice(2) });
  session.addMember({ id: "gm-1", name: "Game Master", role: "gm" });
  session.addMember({ id: "player-1", name: "Player One", role: "player" });

  session.addCombatant({
    id: "hero",
    name: "Hero",
    x: 0,
    y: 0,
    alliance: "player",
    initiative: 0,
    speedFeet: 25,
    maxActions: 3,
    maxHP: 30,
    currentHP: 30,
    ac: 15,
    attackBonus: 10,
    damage: "1d8",
    saves: { fortitude: 5, reflex: 5, will: 5 },
    skills: { athletics: 8, acrobatics: 8 },
  });
  session.addCombatant({
    id: "enemy",
    name: "Enemy",
    x: 1,
    y: 0,
    alliance: "enemy",
    initiative: 0,
    speedFeet: 25,
    maxActions: 3,
    maxHP: 20,
    currentHP: 20,
    ac: 15,
    attackBonus: 8,
    damage: "1d6",
    saves: { fortitude: 5, reflex: 5, will: 5 },
    skills: { athletics: 5, acrobatics: 5 },
  });

  session.assignToken("player-1", "hero");
  session.start({ rolls: { hero: 20, enemy: 10 } });
  return session;
}

function combatantState(state, id) {
  return state.combatants.find(function (combatant) {
    return combatant.id === id;
  });
}

// --------------------------------------------------------------- direct tests

test("GM can perform a Strike on behalf of any combatant", function () {
  const session = makeSession();
  const result = session.dispatchAction("gm", "gm-1", {
    action: "strike",
    payload: {
      combatantId: "enemy",
      targetId: "hero",
      rollD20: function () {
        return 15;
      },
      rollDamageDie: function () {
        return 4;
      },
    },
  });

  assert.equal(result.ok, true, "GM Strike should succeed");
  assert.equal(combatantState(result.state, "enemy").actionsRemaining, 2);
  assert.ok(
    combatantState(result.state, "hero").currentHP < 30,
    "the target should take damage",
  );
  assert.ok(result.logEntries.length > 0, "the combat log should receive entries");
  assert.ok(
    result.logEntries.every(function (entry) {
      return (
        typeof entry.id === "string" &&
        typeof entry.timestamp === "string" &&
        typeof entry.type === "string" &&
        typeof entry.message === "string" &&
        Object.prototype.hasOwnProperty.call(entry, "payload")
      );
    }),
    "combat log entries should be structured",
  );
});

test("player cannot command another token or act out of turn", function () {
  const session = makeSession();

  const foreign = session.dispatchAction("player", "player-1", {
    action: "stride",
    payload: { combatantId: "enemy", destination: { x: 2, y: 0 } },
  });
  assert.equal(foreign.ok, false);
  assert.equal(foreign.reason, "permission-denied");

  const endTurn = session.dispatchAction("gm", "gm-1", {
    action: "end-turn",
    payload: {},
  });
  assert.equal(endTurn.ok, true);

  const outOfTurn = session.dispatchAction("player", "player-1", {
    action: "raise-shield",
    payload: { combatantId: "hero" },
  });
  assert.equal(outOfTurn.ok, false);
  assert.equal(outOfTurn.reason, "not-your-turn");

  const ownTurn = session.dispatchAction("gm", "gm-1", {
    action: "end-turn",
    payload: {},
  });
  assert.equal(ownTurn.ok, true);

  const allowed = session.dispatchAction("player", "player-1", {
    action: "raise-shield",
    payload: { combatantId: "hero" },
  });
  assert.equal(allowed.ok, true);
  assert.equal(combatantState(allowed.state, "hero").actionsRemaining, 2);
});

test("successful Stride and Strike spend actions and return a serializable snapshot", function () {
  const session = makeSession();

  const stride = session.dispatchAction("player", "player-1", {
    action: "stride",
    payload: { combatantId: "hero", destination: { x: 0, y: 1 } },
  });
  assert.equal(stride.ok, true);
  assert.equal(combatantState(stride.state, "hero").actionsRemaining, 2);
  assert.equal(combatantState(stride.state, "hero").x, 0);
  assert.equal(combatantState(stride.state, "hero").y, 1);
  assert.ok(
    stride.logEntries.some(function (entry) {
      return entry.type === "combatant:moved";
    }),
    "Stride should emit a movement event",
  );

  const strike = session.dispatchAction("player", "player-1", {
    action: "strike",
    payload: {
      combatantId: "hero",
      targetId: "enemy",
      rollD20: function () {
        return 18;
      },
      rollDamageDie: function () {
        return 3;
      },
    },
  });
  assert.equal(strike.ok, true);
  assert.equal(combatantState(strike.state, "hero").actionsRemaining, 1);
  assert.ok(
    combatantState(strike.state, "enemy").currentHP < 20,
    "Strike should reduce the target's HP",
  );

  // The snapshot must remain pure JSON (no combatant instances or event buses).
  assert.doesNotThrow(function () {
    JSON.stringify(strike.state);
  });
  assert.doesNotThrow(function () {
    JSON.stringify(strike.logEntries);
  });
});

test("end-turn advances the initiative queue", function () {
  const session = makeSession();
  assert.equal(session.encounter.activeCombatant.id, "hero");

  const result = session.dispatchAction("player", "player-1", {
    action: "end-turn",
    payload: { combatantId: "hero" },
  });

  assert.equal(result.ok, true);
  assert.equal(result.state.encounter.activeCombatantId, "enemy");
  assert.equal(result.state.encounter.round, 1);
  assert.ok(
    result.logEntries.some(function (entry) {
      return entry.type === "turn:changed";
    }),
    "end-turn should log the turn change",
  );
});

// ----------------------------------------------------------- WebSocket tests

function openClient(port) {
  return new Promise(function (resolve, reject) {
    const ws = new WebSocket("ws://127.0.0.1:" + port + "/ws");
    const messages = [];
    const waiters = [];

    ws.on("message", function (raw) {
      let message;
      try {
        message = JSON.parse(String(raw));
      } catch (error) {
        return;
      }
      const waiterIndex = waiters.findIndex(function (waiter) {
        return waiter.predicate(message);
      });
      if (waiterIndex !== -1) {
        const waiter = waiters.splice(waiterIndex, 1)[0];
        clearTimeout(waiter.timer);
        waiter.resolve(message);
        return;
      }
      messages.push(message);
    });

    function waitFor(predicate, timeoutMs) {
      const existingIndex = messages.findIndex(predicate);
      if (existingIndex !== -1) {
        return Promise.resolve(messages.splice(existingIndex, 1)[0]);
      }
      return new Promise(function (resolveWait, rejectWait) {
        const timer = setTimeout(function () {
          const index = waiters.findIndex(function (waiter) {
            return waiter.timer === timer;
          });
          if (index !== -1) {
            waiters.splice(index, 1);
          }
          rejectWait(
            new Error(
              "Timed out waiting for WebSocket message. Seen: " +
                messages
                  .map(function (message) {
                    return message.type;
                  })
                  .join(", "),
            ),
          );
        }, timeoutMs || 3000);
        waiters.push({ predicate: predicate, resolve: resolveWait, timer: timer });
      });
    }

    ws.once("open", function () {
      resolve({
        ws: ws,
        send: function (message) {
          ws.send(JSON.stringify(message));
        },
        waitFor: waitFor,
        close: function () {
          ws.close();
        },
      });
    });
    ws.once("error", reject);
  });
}

function delay(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

test("WebSocket pipeline broadcasts room:state-update after a successful action", async function () {
  await serverModule.startServer(0, "127.0.0.1");
  const address = serverModule.server.address();
  const clients = [];

  try {
    const gm = await openClient(address.port);
    const player = await openClient(address.port);
    clients.push(gm, player);

    gm.send({
      type: "join",
      payload: { sessionId: "ws-action-room", memberId: "ws-gm", name: "GM", role: "gm" },
    });
    await gm.waitFor(function (message) {
      return message.type === "joined";
    });

    player.send({
      type: "join",
      payload: {
        sessionId: "ws-action-room",
        memberId: "ws-player",
        name: "Player",
        role: "player",
      },
    });
    await player.waitFor(function (message) {
      return message.type === "joined";
    });

    gm.send({
      type: "room:add-combatant",
      payload: {
        combatant: {
          id: "ws-hero",
          name: "WS Hero",
          x: 0,
          y: 0,
          alliance: "player",
          initiative: 0,
          speedFeet: 25,
          maxHP: 30,
          currentHP: 30,
          ac: 15,
          attackBonus: 8,
          damage: "1d8",
        },
      },
    });
    await gm.waitFor(function (message) {
      return message.type === "room:combatant-added";
    });

    gm.send({
      type: "room:add-combatant",
      payload: {
        combatant: {
          id: "ws-enemy",
          name: "WS Enemy",
          x: 1,
          y: 0,
          alliance: "enemy",
          initiative: 0,
          speedFeet: 25,
          maxHP: 20,
          currentHP: 20,
          ac: 15,
          attackBonus: 6,
          damage: "1d6",
        },
      },
    });
    await gm.waitFor(function (message) {
      return message.type === "room:combatant-added";
    });

    gm.send({
      type: "room:start",
      payload: { initiative: { rolls: { "ws-hero": 20, "ws-enemy": 10 } } },
    });
    await gm.waitFor(function (message) {
      return message.type === "turn:changed";
    });

    gm.send({
      type: "room:assign-token",
      payload: { playerId: "ws-player", combatantId: "ws-hero" },
    });
    await player.waitFor(function (message) {
      return message.type === "room:token-assigned";
    });

    player.send({
      type: "room:action",
      intent: {
        action: "stride",
        payload: { combatantId: "ws-hero", destination: { x: 0, y: 1 } },
      },
    });

    const playerUpdate = await player.waitFor(function (message) {
      return (
        message.type === "room:state-update" &&
        Array.isArray(message.logEntries) &&
        message.logEntries.some(function (entry) {
          return entry.type === "combatant:moved";
        })
      );
    });

    const gmUpdate = await gm.waitFor(function (message) {
      return (
        message.type === "room:state-update" &&
        Array.isArray(message.logEntries) &&
        message.logEntries.some(function (entry) {
          return entry.type === "combatant:moved";
        })
      );
    });

    assert.ok(playerUpdate.state, "the player should receive the snapshot");
    assert.ok(gmUpdate.state, "the GM should receive the snapshot");
    assert.equal(combatantState(playerUpdate.state, "ws-hero").actionsRemaining, 2);
    assert.equal(combatantState(playerUpdate.state, "ws-hero").y, 1);

    gm.send({ type: "room:sync", requestId: "sync-1" });
    const sync = await gm.waitFor(function (message) {
      return message.type === "room:state-update" && message.requestId === "sync-1";
    });
    assert.ok(sync.state, "room:sync should return the full state");
    assert.ok(
      sync.logEntries.length > 0,
      "room:sync should return the accumulated combat log",
    );

    const playerAction = player.waitFor(function (message) {
      return message.type === "room:action-error";
    });
    player.send({
      type: "room:action",
      intent: {
        action: "raise-shield",
        payload: { combatantId: "ws-enemy" },
      },
    });
    const error = await playerAction;
    assert.equal(error.reason, "permission-denied");
    assert.equal(error.intent.action, "raise-shield");
  } finally {
    for (const client of clients) {
      client.close();
    }
    await delay(50);
    await serverModule.closeServer();
  }
});

// ------------------------------------------------------------------- runner

async function main() {
  let failures = 0;
  for (const entry of tests) {
    try {
      await entry.handler();
      console.log("  ok   " + entry.name);
    } catch (error) {
      failures += 1;
      console.error("  FAIL " + entry.name);
      console.error(error && error.stack ? error.stack : String(error));
    }
  }

  console.log("");
  console.log(String(tests.length - failures) + " passed, " + String(failures) + " failed");
  if (failures > 0) {
    process.exitCode = 1;
  }
}

main();
