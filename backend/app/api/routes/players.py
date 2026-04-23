from fastapi import APIRouter, HTTPException
from app.services.nba_service import search_player, get_player_game_log, get_player_vs_team, get_player_without_teammate, get_player_teammates, get_player_season_averages, get_player_head_to_head, get_player_defender_breakdown, get_player_team_injuries, get_player_headshot_url, get_prizepicks_lines, _normalize_name

router = APIRouter()


@router.get("/search")
async def search(name: str):
    results = search_player(name)
    if not results:
        raise HTTPException(status_code=404, detail="Player not found")
    return results


@router.get("/{player_id}/gamelog")
async def game_log(player_id: str, season: str = "2026"):
    return get_player_game_log(player_id, season)


@router.get("/{player_id}/vs")
async def vs_team(player_id: str, opponent: str, season: str = "2026"):
    """Returns game log filtered to games against a specific opponent team."""
    return get_player_vs_team(player_id, opponent, season)


@router.get("/{player_id}/teammates")
async def teammates(player_id: str):
    """Returns the current roster of the player's team, excluding themselves."""
    return get_player_teammates(player_id)


@router.get("/{player_id}/without/{teammate_id}")
async def without_teammate(player_id: str, teammate_id: str, season: str = "2026"):
    """Returns with/without split averages for a player when a teammate is in/out."""
    return get_player_without_teammate(player_id, teammate_id, season)


@router.get("/{player_id}/season-averages")
async def season_averages(player_id: str, season: str = "2026"):
    """Returns ESPN's official season averages for a player."""
    return get_player_season_averages(player_id, season)


@router.get("/{player_id}/h2h/{opponent_id}")
async def head_to_head(player_id: str, opponent_id: str, season: str = "2026"):
    """Returns play-level interactions (blocks, steals, assists) between two players."""
    return get_player_head_to_head(player_id, opponent_id, season)


@router.get("/{player_id}/defender-breakdown")
async def defender_breakdown(player_id: str, season: str = "2026"):
    """Returns all defenders ranked by shots attempted against this offensive player."""
    return get_player_defender_breakdown(player_id, season)


@router.get("/{player_id}/team-injuries")
async def team_injuries(player_id: str):
    """Returns current ESPN injury report for the player's team."""
    return get_player_team_injuries(player_id)


@router.get("/{player_id}/headshot")
async def headshot(player_id: str):
    url = get_player_headshot_url(player_id)
    if not url:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Headshot not found")
    return {"url": url}


@router.get("/{player_id}/prizepicks")
async def prizepicks(player_id: str, player_name: str):
    """Returns {lines, status} — status is 'ok', 'rate_limited', or 'unavailable'."""
    import time
    from app.services.nba_service import _pp_cache, _pp_cache_ts, _load_pp_disk_cache, _PP_CACHE_TTL

    lines = get_prizepicks_lines(player_name)
    now = time.time()

    # If we have lines, all good
    if lines:
        return {"lines": lines, "status": "ok"}

    # Check what state the cache is in
    cache_age = now - _pp_cache_ts if _pp_cache_ts > 0 else None
    _, disk_ts = _load_pp_disk_cache()
    disk_age = now - disk_ts if disk_ts > 0 else None

    if cache_age is not None and cache_age < _PP_CACHE_TTL:
        # Cache is fresh but player just isn't listed
        return {"lines": {}, "status": "ok"}

    # Cache is stale/empty — likely rate limited
    return {"lines": {}, "status": "rate_limited"}


@router.get("/prizepicks/debug")
async def prizepicks_debug(name: str = ""):
    """Debug: cache state only — never hits the live API."""
    import time
    from app.services.nba_service import _pp_cache, _pp_cache_ts, _load_pp_disk_cache, _PP_DISK_PATH

    mem_keys = sorted(_pp_cache.keys())
    disk_data, disk_ts = _load_pp_disk_cache()

    result: dict = {
        "memory_cache": {
            "total_players": len(mem_keys),
            "age_seconds": round(time.time() - _pp_cache_ts) if _pp_cache_ts > 0 else None,
        },
        "disk_cache": {
            "path": str(_PP_DISK_PATH),
            "total_players": len(disk_data),
            "age_seconds": round(time.time() - disk_ts) if disk_ts > 0 else None,
        },
    }
    if name:
        normalized = _normalize_name(name)
        words = normalized.split()
        all_keys = sorted(disk_data.keys()) if disk_data else mem_keys
        result["search"] = {
            "query": normalized,
            "match": get_prizepicks_lines(name),
            "near_matches": [k for k in all_keys if any(w in k for w in words)],
        }
    return result
