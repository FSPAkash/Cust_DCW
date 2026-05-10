# Data Persistence Fix — Gist + localStorage Merge

## The bug

On load, the dashboard hydrates from `localStorage` first, then fetches the gist and overwrites with gist data. This caused two failure modes:

1. **Edits lost on reload.** A user edits week K, the debounced `sg()` save fires, but if they reload before it lands (or the PATCH fails silently), the next `init()` pulls the older gist copy and clobbers the local edit.
2. **Cross-device stomping.** Device A saves week K. Device B, which still has a stale local copy of week K, loads, merges naively (or last-write-wins by load order), and pushes its stale copy back — erasing A's edit.

Root cause: there was no per-key freshness signal, so the merge couldn't tell which side was newer.

## The fix

Three coordinated changes:

### 1. Stamp every save with `_ts` and track dirty keys in-session

In `save()`:

```js
function save(){
  const k=wk(weekOff);
  if(allData[k]){
    allData[k]._ts=Date.now();   // freshness marker
    dirtyKeys.add(k);            // "this session edited this key"
  }
  sc();
  si();
  clearTimeout(saveT);
  saveT=setTimeout(()=>sg(),1500);
}
```

`dirtyKeys` is a module-level `Set` declared alongside the other state:

```js
let weekOff=-1,admin=false,allData={},gistOk=!!GIST_ID,saveT=null,dirtyKeys=new Set();
```

### 2. Merge by timestamp in `init()`, not by load order

Replace any "load local, then overwrite with gist" logic with a per-key merge:

```js
async function init(){
  allData=lc();
  // ...clamp weekOff, initial render...
  render();

  if(gistOk){
    const gd=await lg();
    if(gd===null){
      // fetch failed — keep localStorage, do nothing
    } else if(Object.keys(gd).length>0){
      const localKeys=Object.keys(allData);
      const gistKeys=Object.keys(gd);
      const merged={};
      const allKeys=new Set([...gistKeys,...localKeys]);
      for(const k of allKeys){
        const lv=allData[k],gv=gd[k];
        if(!lv){merged[k]=gv;continue;}
        if(!gv){merged[k]=lv;continue;}
        // Both exist. If user edited this key this session, local wins unconditionally.
        if(dirtyKeys.has(k)){merged[k]=lv;continue;}
        // Otherwise pick newer by _ts (fallback to local on tie/missing).
        const lts=lv._ts||0,gts=gv._ts||0;
        merged[k]=(gts>lts)?gv:lv;
      }
      allData=merged;
      sc();
      render();
      // If local had keys gist didn't, push the merged result back.
      if(localKeys.some(k=>!gistKeys.includes(k))){
        sg();
      }
    } else if(Object.keys(allData).length>0){
      // Gist empty, local has data — seed the gist.
      await sg();
    }
  }
}
```

### 3. Don't trust gist load failures as "no data"

`lg()` must return `null` (not `{}`) on fetch failure, and `init()` must treat `null` as "keep localStorage, don't touch anything." Returning `{}` on failure would wipe local data on the next save.

```js
async function lg(){
  if(!gistOk)return null;
  try{
    const r=await fetch('https://api.github.com/gists/'+GIST_ID,
      {headers:{'Accept':'application/vnd.github.v3+json'},cache:'no-store'});
    if(!r.ok)throw new Error('HTTP '+r.status);
    const g=await r.json(),f=g.files[GIST_FILE];
    if(!f)throw new Error('no file named '+GIST_FILE);
    return JSON.parse(f.content);
  }catch(e){
    console.error('[GIST] Load FAILED:',e.message);
    return null;   // critical: null, not {}
  }
}
```

Also note `cache:'no-store'` on the fetch — without it, the browser can serve a stale gist response and reintroduce the same overwrite bug.

## Why each piece matters

- **`_ts` per key** gives the merge a real freshness signal instead of guessing by load order.
- **`dirtyKeys`** protects against the race where a user edits week K and reloads (or the tab refetches) before the debounced PATCH lands — without it, the in-flight gist response would clobber the unsaved edit.
- **`null` on fetch failure** ensures a transient network blip doesn't get interpreted as "the gist is empty, push local over it" or "the gist is empty, wipe local."
- **`cache:'no-store'`** prevents the browser HTTP cache from masking real gist state.

## Applying to another dashboard

Checklist for the other dashboard:

1. Add `dirtyKeys=new Set()` to module state.
2. In the save function: set `allData[k]._ts=Date.now()` and `dirtyKeys.add(k)` before `sc()` and the debounced remote save.
3. In the gist/remote load function: return `null` on any error, never `{}`. Add `cache:'no-store'` to the fetch.
4. Replace the init merge with the per-key timestamp merge above. Order of precedence per key: only-one-side-has-it → that side; both sides + dirty → local; both sides → newer `_ts` → fallback local.
5. After merge, if local had keys the remote didn't, push the merged result back so the remote catches up.
6. If existing data in the remote/local has no `_ts`, that's fine — it'll be treated as `0` and lose to anything stamped, which is the right behavior (stamped = known-recent).

## Files touched in this dashboard

- [index.html:499](index.html#L499) — `dirtyKeys` declaration
- [index.html:550-563](index.html#L550-L563) — `lg()` returns `null` on failure, `cache:'no-store'`
- [index.html:577](index.html#L577) — `save()` stamps `_ts` and adds to `dirtyKeys`
- [index.html:871-918](index.html#L871-L918) — `init()` per-key timestamp merge
