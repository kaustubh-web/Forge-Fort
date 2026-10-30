import {useCallback, useEffect, useReducer,useRef, useState} from "react";
import { executeWorkflow,cancelExecution,getExecution, } from "@/lib/executionApi";
import { openExecutionStream } from "@/lib/executionStream";
import { applyEvent,fromSnapshot,isFinished } from "@/lib/executionState";


const RETRY_DELAY_MS = [1000, 2000, 5000, 10000];

function reducer(state, action){
    switch(action.type){
        case "reset":
            return null;
        case "snapshot":
            return fromSnapshot(action.execution);
        case "event":
            return applyEvent(state, action.event);
        default:
            return state;
    }
}

// execution   null, or the state from lib/executionState.js (status, order, nodes, error...)
// connection  "idle" | "live" | "reconnecting" | "error"

export function useExecution(){
    const [execution,dispatch] = useReducer(reducer,null);
    const [connection, setConnection] = useState("idle");
    const [error, setError] = useState(null);

    const closeStream = useRef(null);
    const retry = useRef({ attempt: 0, timer: null});
    const currentId = useRef(null);

    const disconnect = useCallback(()=>{
        closeStream.current?.();
        closeStream.current = null;
        clearTimeout(retry.current.timer);
    },[]);

    // A named function, so the reconnect timer below can call it by name (connectStream)
    // instead of reading `connect` while it is still being defined.
    const connect = useCallback(
        function connectStream(executionId){
            disconnect();
            currentId.current = executionId;
            setConnection("live");

            closeStream.current = openExecutionStream(executionId,{
                onEvent: (event)=>{
                    retry.current.attempt = 0;
                    dispatch({type:"event",event});
                    if(event.type.startsWith("workflow.") && isFinished(event.data.status)){
                        getExecution(executionId)
                        .then((stored)=> currentId.current === executionId && dispatch({type: "snapshot", execution: stored}))
                        .catch(()=>{});
                    }
                },
                onEnd: ()=>{
                    closeStream.current = null;
                    setConnection("idle");
                },

                onError: (err)=>{
                    closeStream.current = null;
                    if(err.status && err.status<500){
                        setError(err.message);
                        setConnection("error");
                        return;
                    }
                    const attempt = retry.current.attempt++;
                    if(attempt>= RETRY_DELAY_MS.length){
                        setError("Lost the live connection. Refresh the page to see the latest state.");
                        setConnection("error");
                        return;
                    }
                    setConnection("reconnecting");
                    retry.current.timer = setTimeout(()=>connectStream(executionId),RETRY_DELAY_MS[attempt]);
                },
            });

        },
        [disconnect]
    );

    //run the saved flow and throw axios error

    const start = useCallback(
        async(workflowId, input)=>{
            disconnect();
            dispatch({type: "reset"});
            setError(null);
            const {executionId} = await executeWorkflow(workflowId, input);
            retry.current.attempt = 0;
            connect(executionId);
            return executionId;
        },
        [connect,disconnect]
    );

    //ask server to cancel

    const stop = useCallback(async()=>{
        if(currentId.current) await cancelExecution(currentId.current);
    },[]);

    //show existing execution

    const load =  useCallback(
        (executionId)=>{
            setError(null);
            retry.current.attempt = 0;
            connect(executionId);
        },
        [connect]
    );

    const clear = useCallback(()=>{
        disconnect();
        currentId.current=null;
        dispatch({type: "reset"});
        setConnection("idle");
        setError(null);
    },[disconnect]);

    // leaving the editor closes the stream; the run itself goes on
    useEffect(()=> disconnect,[disconnect]);

    return {execution,connection,error,start,stop,load,clear};
}
