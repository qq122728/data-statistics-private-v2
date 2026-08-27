import { NextResponse } from "next/server";

const broadStatus: number = 403;

export const quotedStatus = NextResponse.json({}, { "status": 403 });
export const computedStatus = NextResponse.json({}, { ["status"]: 403 });
export const nextElementJson = NextResponse["json"]({}, { status: 403 });
export const responseElementJson = Response["json"]({}, { status: broadStatus });
export const computedElementJson = NextResponse[`json`]({}, { ["status"]: broadStatus });
