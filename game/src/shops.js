// shops.js — three frontages that take money and give something back.
//
// A shop is a place with a marker, a price and one effect: ammo, a repaired car, or a bigger body.
// The plan puts all three on forecourts along the coast boulevard, so a mission that asks the player
// to "restock at Ironside Arms" is asking them to drive somewhere, not to open a menu.
//
// Standing inside a marker with enough cash prompts the buy; pressing E takes the money and applies
// the effect once, with a cooldown, so holding the key does not drain a wallet. What the effect
// changed is reported back to the sim so the HUD can print it and the mission chain can see it.

import { GUN } from './scale.js';
import { addRespect, announce } from './story.js';

/** The shop a point is standing in, or null. */
export function shopAt(plan, x, z) {
  for (const shop of plan.shops) {
    if (Math.hypot(shop.at.x - x, shop.at.z - z) < shop.radius + 1.6) return shop;
  }
  return null;
}

/** The shop record for an id, for a mission that names one. */
export function shopById(plan, id) {
  return plan.shops.find((s) => s.id === id) ?? null;
}

/**
 * What the prompt should say at this spot, or ''. The distance gate is a little wider than the
 * marker so the prompt appears as the player walks up rather than once they are standing on it.
 */
export function shopPrompt(sim) {
  if (sim.mode !== 'play') return '';
  const shop = shopAt(sim.plan, sim.player.x, sim.player.z);
  if (!shop) return '';
  // In a car, only a garage with something to fix offers a counter; everywhere else the prompt is
  // the car door's.
  if (sim.player.driving && !(shop.kind === 'garage' && sim.player.driving.condition < 0.999)) return '';
  const afford = sim.story.cash >= shop.price ? '' : '  ·  NOT ENOUGH';
  return `E · ${shop.name}  ·  $${shop.price}${afford}`;
}

/**
 * Buy from the shop the player is standing at. Returns the shop when something was bought, so the
 * sim can flash the wallet and the mission test can see it.
 */
export function buyAtShop(sim, shop) {
  const p = sim.player;
  const story = sim.story;
  if (!shop) return null;
  if (sim.shopCool > 0) return null;
  if (story.cash < shop.price) {
    announce(story, `NOT ENOUGH CASH  ·  ${shop.name} WANTS $${shop.price}`, 2.4);
    return null;
  }
  story.cash -= shop.price;
  story.spent += shop.price;
  sim.shopCool = 0.6;
  story.bought = shop.id;

  if (shop.kind === 'gun') {
    p.ammo = Math.min(240, p.ammo + 45);
    p.clip = GUN.magazine;
    announce(story, `+45 ROUNDS  ·  $${shop.price} SPENT AT ${shop.name}`, 3);
  } else if (shop.kind === 'garage') {
    if (p.driving) {
      p.driving.condition = 1;
      announce(story, `${p.driving.shape.model ?? 'THE CAR'} REPAIRED  ·  $${shop.price}`, 3);
    } else {
      // Nothing in the bay: the money still buys the next car's repair, held as a voucher.
      story.repairVoucher = (story.repairVoucher ?? 0) + 1;
      announce(story, `REPAIR VOUCHER BOUGHT  ·  $${shop.price}`, 3);
    }
    for (const car of sim.traffic) {
      if (car.stolen) car.condition = 1;
    }
  } else if (shop.kind === 'clothier') {
    p.hpMax = Math.min(160, p.hpMax + 20);
    p.hp = p.hpMax;
    p.armour = Math.min(60, p.armour + 25);
    announce(story, `MAX HEALTH ${p.hpMax}  ·  $${shop.price} AT ${shop.name}`, 3);
  }

  addRespect(story, 25, shop.name);
  sim.events.onShop?.(shop);
  return shop;
}

/** Where a shop's marker sits, for a mission that names it. */
export function shopAnchor(plan, id) {
  const shop = shopById(plan, id);
  return shop ? { at: shop.at, radius: shop.radius } : null;
}
