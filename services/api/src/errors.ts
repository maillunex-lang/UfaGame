export class DomainError extends Error {
 code:string;status:number;
 constructor(code:string,status=400){super(code);this.code=code;this.status=status;}
}
