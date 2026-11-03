export class DomainError extends Error {
 code:string;status:number;detail?:string;
 constructor(code:string,status=400,detail?:string){super(code);this.code=code;this.status=status;this.detail=detail;}
}
