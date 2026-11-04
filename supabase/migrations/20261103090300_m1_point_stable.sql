-- private.point raises on bad input via a STABLE helper, so it cannot be IMMUTABLE.
alter function private.point(double precision, double precision) stable;
