"use client";
import { useEffect, useState } from "react";
import CustomerSheet from "../../../packages/customer-sheet/CustomerSheet";
import { requestJson, type Member } from "../lib/backend";
export function RealCustomerProgress({groupId}:{members:Member[];readOnly?:boolean;groupId?:string;expertActorId?:string}) {
 const [current,setCurrent]=useState(groupId??"");
 useEffect(()=>{if(groupId)setCurrent(groupId);else void requestJson<{user:{groupId:string}}>("/api/auth/me").then(r=>setCurrent(r.user.groupId));},[groupId]);
 return <CustomerSheet initialGroupId={current}/>;
}
