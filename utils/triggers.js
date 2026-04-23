/**
 * Shared Trigger Utilities
 */

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Compiles a trigger string into a RegExp if it contains ${name:regex} syntax.
 * Example: ";task ${id:\d+}" -> /;task (?<id>\d+)$/
 */
function compileTrigger(trigger) {
  if (!trigger.includes('${')) {
    return { isRegex: false, literal: trigger };
  }

  const placeholders = [];
  const flagsSet = new Set();
  
  let pattern = trigger.replace(/\$\{([^:]+)(?::([^}]+))?\}/g, (match, name, inner) => {
    const id = placeholders.length;
    let regex = inner || '[^ ]+';
    
    // Check for flags within inner part: regex:flags
    // We look for the last colon to separate regex from flags
    if (inner && inner.includes(':')) {
      const lastColonIndex = inner.lastIndexOf(':');
      const potentialFlags = inner.substring(lastColonIndex + 1);
      // Valid JS regex flags: g, i, m, s, u, y
      if (/^[gimsuy]+$/.test(potentialFlags)) {
        regex = inner.substring(0, lastColonIndex);
        [...potentialFlags].forEach(f => flagsSet.add(f));
      }
    }

    placeholders.push(`(?<${name}>${regex})`);
    return `__SNIP_PH_${id}__`;
  });

  pattern = escapeRegex(pattern);
  placeholders.forEach((ph, i) => {
    pattern = pattern.replace(`__SNIP_PH_${i}__`, ph);
  });

  const flags = [...flagsSet].join('');

  try {
    return { isRegex: true, regex: new RegExp(pattern + '$', flags) };
  } catch (e) {
    return { isRegex: false, literal: trigger, error: e.message };
  }
}
